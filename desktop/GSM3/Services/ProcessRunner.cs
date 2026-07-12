namespace GSM3.Services;

using System.Diagnostics;
using System.Text;

/// <summary>
/// Utility for running external processes (e.g. SteamCMD, game servers) with
/// async output capture and process lifecycle management.
/// </summary>
public class ProcessRunner : IDisposable
{
    private Process? _process;

    public event EventHandler<string>? OutputReceived;
    public event EventHandler<string>? ErrorReceived;
    public event EventHandler<int>? Exited;

    public int? ProcessId => _process?.Id;
    public bool IsRunning => _process != null && !_process.HasExited;

    public void Start(string fileName, string arguments = "", string workingDirectory = "",
                      Dictionary<string, string>? envVars = null, bool redirectInput = true)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = redirectInput,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        if (envVars != null)
        {
            foreach (var (key, value) in envVars)
                psi.Environment[key] = value;
        }

        _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _process.OutputDataReceived += (_, e) => { if (e.Data != null) OutputReceived?.Invoke(this, e.Data); };
        _process.ErrorDataReceived += (_, e) => { if (e.Data != null) ErrorReceived?.Invoke(this, e.Data); };
        _process.Exited += (_, _) => Exited?.Invoke(this, _process.ExitCode);

        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
    }

    public void SendInput(string input)
    {
        _process?.StandardInput.WriteLine(input);
    }

    public void SendCtrlC()
    {
        if (_process != null && !_process.HasExited)
        {
            // On Windows, use GenerateConsoleCtrlEvent via P/Invoke
            // Fallback: kill the process
            try { _process.Kill(entireProcessTree: true); }
            catch { }
        }
    }

    public void Kill()
    {
        try { _process?.Kill(entireProcessTree: true); }
        catch { }
    }

    public async Task<int> WaitForExitAsync(CancellationToken ct = default)
    {
        if (_process == null) return -1;
        await _process.WaitForExitAsync(ct);
        return _process.ExitCode;
    }

    public void Dispose()
    {
        _process?.Dispose();
        GC.SuppressFinalize(this);
    }
}
