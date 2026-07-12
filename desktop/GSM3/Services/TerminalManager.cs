namespace GSM3.Services;

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using GSM3.Models;

public class TerminalManager
{
    private readonly ConcurrentDictionary<string, TerminalSessionState> _sessions = new();

    public event EventHandler<TerminalOutputEventArgs>? OnOutput;
    public event EventHandler<string>? OnSessionClosed;

    public TerminalSession CreateSession(string? name = null, string? workingDirectory = null)
    {
        var session = new TerminalSession
        {
            Name = name ?? $"Terminal {_sessions.Count + 1}",
            WorkingDirectory = workingDirectory ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            IsActive = true
        };

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoLogo -NoProfile",
            WorkingDirectory = session.WorkingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null)
                OnOutput?.Invoke(this, new TerminalOutputEventArgs(session.Id, e.Data, false));
        };

        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null)
                OnOutput?.Invoke(this, new TerminalOutputEventArgs(session.Id, e.Data, true));
        };

        process.Exited += (_, _) =>
        {
            if (_sessions.TryRemove(session.Id, out var state))
            {
                state.Session.IsActive = false;
                state.Session.ProcessId = null;
                state.Process.Dispose();
                OnSessionClosed?.Invoke(this, session.Id);
            }
        };

        process.Start();
        session.ProcessId = process.Id;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var sessionState = new TerminalSessionState(session, process);
        _sessions[session.Id] = sessionState;

        return session;
    }

    public bool SendInput(string sessionId, string input)
    {
        if (!_sessions.TryGetValue(sessionId, out var state))
            return false;

        if (state.Process.HasExited)
            return false;

        try
        {
            state.Process.StandardInput.WriteLine(input);
            state.Process.StandardInput.Flush();
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to send input to session {sessionId}: {ex.Message}");
            return false;
        }
    }

    public void CloseSession(string sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var state))
            return;

        state.Session.IsActive = false;
        state.Session.ProcessId = null;

        try
        {
            if (!state.Process.HasExited)
            {
                state.Process.StandardInput.WriteLine("exit");
                if (!state.Process.WaitForExit(3000))
                {
                    state.Process.Kill(entireProcessTree: true);
                }
            }
            state.Process.Dispose();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to close session {sessionId}: {ex.Message}");
        }

        OnSessionClosed?.Invoke(this, sessionId);
    }

    public bool ResizeTerminal(string sessionId, int columns, int rows)
    {
        if (!_sessions.TryGetValue(sessionId, out var state))
            return false;

        // PowerShell resize via command
        try
        {
            if (!state.Process.HasExited)
            {
                state.Process.StandardInput.WriteLine(
                    $"[Console]::WindowWidth = {columns}; [Console]::WindowHeight = {rows}");
                state.Process.StandardInput.Flush();
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    public List<TerminalSession> GetSessions()
    {
        return _sessions.Values.Select(s => s.Session).ToList();
    }

    public void CloseAll()
    {
        foreach (var id in _sessions.Keys.ToList())
        {
            CloseSession(id);
        }
    }

    // ── Internal State ─────────────────────────────────────────

    private sealed class TerminalSessionState
    {
        public TerminalSession Session { get; }
        public Process Process { get; }

        public TerminalSessionState(TerminalSession session, Process process)
        {
            Session = session;
            Process = process;
        }
    }
}

public class TerminalOutputEventArgs : EventArgs
{
    public string SessionId { get; }
    public string Data { get; }
    public bool IsError { get; }

    public TerminalOutputEventArgs(string sessionId, string data, bool isError)
    {
        SessionId = sessionId;
        Data = data;
        IsError = isError;
    }
}
