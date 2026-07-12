namespace GSM3.Services;

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using GSM3.Models;

public class InstanceManager
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string InstancesPath = Path.Combine(DataDir, "instances.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConcurrentDictionary<string, Instance> _instances = new();
    private readonly ConcurrentDictionary<string, Process> _processes = new();
    private readonly SemaphoreSlim _saveLock = new(1, 1);

    public event EventHandler<InstanceStatusEventArgs>? OnInstanceStatusChanged;
    public event EventHandler<InstanceOutputEventArgs>? OnInstanceOutput;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(DataDir);

        if (File.Exists(InstancesPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(InstancesPath);
                var instances = JsonSerializer.Deserialize<List<Instance>>(json, JsonOptions);
                if (instances != null)
                {
                    foreach (var inst in instances)
                    {
                        // Reset runtime state on load
                        inst.Status = InstanceStatus.Stopped;
                        inst.TerminalSessionId = "";
                        _instances[inst.Id] = inst;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to load instances: {ex.Message}");
            }
        }
    }

    public async Task<Instance> CreateInstanceAsync(Instance instance)
    {
        instance.Id = Guid.NewGuid().ToString();
        instance.CreatedAt = DateTime.UtcNow;
        instance.Status = InstanceStatus.Stopped;

        _instances[instance.Id] = instance;
        await SaveAsync();
        return instance;
    }

    public async Task<Instance?> UpdateInstanceAsync(Instance updated)
    {
        if (!_instances.TryGetValue(updated.Id, out var existing))
            return null;

        // Preserve runtime state
        updated.Status = existing.Status;
        updated.TerminalSessionId = existing.TerminalSessionId;
        _instances[updated.Id] = updated;
        await SaveAsync();
        return updated;
    }

    public async Task<bool> DeleteInstanceAsync(string instanceId)
    {
        if (!_instances.TryGetValue(instanceId, out var instance))
            return false;

        if (instance.Status == InstanceStatus.Running)
            await StopInstanceAsync(instanceId);

        _instances.TryRemove(instanceId, out _);
        await SaveAsync();
        return true;
    }

    public async Task<bool> StartInstanceAsync(string instanceId)
    {
        if (!_instances.TryGetValue(instanceId, out var instance))
            return false;

        if (instance.Status == InstanceStatus.Running)
            return true;

        try
        {
            SetStatus(instance, InstanceStatus.Starting);

            var psi = new ProcessStartInfo
            {
                FileName = instance.ProgramPath,
                Arguments = instance.StartCommand,
                WorkingDirectory = string.IsNullOrEmpty(instance.WorkingDirectory)
                    ? Path.GetDirectoryName(instance.ProgramPath) ?? ""
                    : instance.WorkingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                CreateNoWindow = true
            };

            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data != null)
                    OnInstanceOutput?.Invoke(this, new InstanceOutputEventArgs(instanceId, e.Data, false));
            };

            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null)
                    OnInstanceOutput?.Invoke(this, new InstanceOutputEventArgs(instanceId, e.Data, true));
            };

            process.Exited += (_, _) =>
            {
                _processes.TryRemove(instanceId, out _);
                instance.LastStopped = DateTime.UtcNow;
                SetStatus(instance, process.ExitCode != 0 ? InstanceStatus.Crashed : InstanceStatus.Stopped);
                _ = SaveAsync();
            };

            if (!process.Start())
            {
                SetStatus(instance, InstanceStatus.Crashed);
                return false;
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            _processes[instanceId] = process;
            instance.LastStarted = DateTime.UtcNow;
            SetStatus(instance, InstanceStatus.Running);
            await SaveAsync();
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to start instance {instanceId}: {ex.Message}");
            SetStatus(instance, InstanceStatus.Crashed);
            return false;
        }
    }

    public async Task<bool> StopInstanceAsync(string instanceId)
    {
        if (!_instances.TryGetValue(instanceId, out var instance))
            return false;

        if (instance.Status != InstanceStatus.Running)
            return true;

        SetStatus(instance, InstanceStatus.Stopping);

        if (_processes.TryRemove(instanceId, out var process))
        {
            try
            {
                if (!process.HasExited)
                {
                    // Try graceful shutdown based on StopCommandType
                    try
                    {
                        switch (instance.StopCommandType)
                        {
                            case StopCommand.Stop:
                                await process.StandardInput.WriteLineAsync("stop");
                                break;
                            case StopCommand.Exit:
                                await process.StandardInput.WriteLineAsync("exit");
                                break;
                            case StopCommand.Quit:
                                await process.StandardInput.WriteLineAsync("quit");
                                break;
                            case StopCommand.CtrlC:
                            default:
                                // Send Ctrl+C is not reliably possible via StandardInput,
                                // fall through to Kill
                                break;
                        }

                        // Wait briefly for graceful shutdown
                        if (!process.WaitForExit(5000))
                        {
                            process.Kill(entireProcessTree: true);
                            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                        }
                    }
                    catch
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
                process.Dispose();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to stop instance {instanceId}: {ex.Message}");
            }
        }

        instance.LastStopped = DateTime.UtcNow;
        SetStatus(instance, InstanceStatus.Stopped);
        await SaveAsync();
        return true;
    }

    public async Task<bool> RestartInstanceAsync(string instanceId)
    {
        await StopInstanceAsync(instanceId);
        await Task.Delay(1000); // brief pause between stop and start
        return await StartInstanceAsync(instanceId);
    }

    public List<Instance> GetInstances() => _instances.Values.ToList();

    public Instance? GetInstance(string instanceId) =>
        _instances.TryGetValue(instanceId, out var inst) ? inst : null;

    /// <summary>
    /// Send input to a running instance's stdin.
    /// </summary>
    public bool SendInput(string instanceId, string input)
    {
        if (!_processes.TryGetValue(instanceId, out var process))
            return false;

        try
        {
            if (process.HasExited) return false;
            process.StandardInput.WriteLine(input);
            process.StandardInput.Flush();
            return true;
        }
        catch
        {
            return false;
        }
    }

    // ── Helpers ────────────────────────────────────────────────

    private void SetStatus(Instance instance, InstanceStatus status)
    {
        var previous = instance.Status;
        instance.Status = status;
        OnInstanceStatusChanged?.Invoke(this,
            new InstanceStatusEventArgs(instance.Id, previous, status));
    }

    private async Task SaveAsync()
    {
        await _saveLock.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(_instances.Values.ToList(), JsonOptions);
            await File.WriteAllTextAsync(InstancesPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to save instances: {ex.Message}");
        }
        finally
        {
            _saveLock.Release();
        }
    }
}

// ── Event Args ─────────────────────────────────────────────────

public class InstanceStatusEventArgs : EventArgs
{
    public string InstanceId { get; }
    public InstanceStatus PreviousStatus { get; }
    public InstanceStatus NewStatus { get; }

    public InstanceStatusEventArgs(string instanceId, InstanceStatus previous, InstanceStatus next)
    {
        InstanceId = instanceId;
        PreviousStatus = previous;
        NewStatus = next;
    }
}

public class InstanceOutputEventArgs : EventArgs
{
    public string InstanceId { get; }
    public string Data { get; }
    public bool IsError { get; }

    public InstanceOutputEventArgs(string instanceId, string data, bool isError)
    {
        InstanceId = instanceId;
        Data = data;
        IsError = isError;
    }
}
