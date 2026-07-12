namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Text;

public partial class TerminalViewModel : ObservableObject
{
    private readonly TerminalManager _terminalManager;
    private readonly object _outputLock = new();
    private readonly Dictionary<string, StringBuilder> _sessionOutputs = new();

    public ObservableCollection<TerminalSession> Sessions { get; } = new();

    [ObservableProperty] private TerminalSession? selectedSession;
    [ObservableProperty] private string outputText = "";
    [ObservableProperty] private string inputText = "";
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private int maxOutputLines = 5000;

    public TerminalViewModel()
    {
        _terminalManager = ServiceLocator.GetService<TerminalManager>();
        _terminalManager.OnOutput += OnTerminalOutput;
        _terminalManager.OnSessionClosed += OnSessionClosed;
    }

    public void Load()
    {
        RefreshSessions();
    }

    partial void OnSelectedSessionChanged(TerminalSession? value)
    {
        if (value == null)
        {
            OutputText = "";
            return;
        }

        lock (_outputLock)
        {
            if (_sessionOutputs.TryGetValue(value.Id, out var sb))
                OutputText = sb.ToString();
            else
                OutputText = "";
        }
    }

    [RelayCommand]
    private void CreateSession()
    {
        try
        {
            var sessionName = $"Terminal {Sessions.Count + 1}";
            var session = _terminalManager.CreateSession(sessionName);

            lock (_outputLock)
            {
                _sessionOutputs[session.Id] = new StringBuilder();
            }

            Sessions.Add(session);
            SelectedSession = session;
            StatusMessage = $"Session '{session.Name}' created.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to create session: {ex.Message}";
            Debug.WriteLine($"CreateSession error: {ex}");
        }
    }

    [RelayCommand]
    private void CloseSession()
    {
        if (SelectedSession == null)
        {
            StatusMessage = "No session selected.";
            return;
        }

        try
        {
            var name = SelectedSession.Name;
            var id = SelectedSession.Id;

            _terminalManager.CloseSession(id);

            lock (_outputLock)
            {
                _sessionOutputs.Remove(id);
            }

            Sessions.Remove(SelectedSession);
            SelectedSession = Sessions.LastOrDefault();
            StatusMessage = $"Session '{name}' closed.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to close session: {ex.Message}";
            Debug.WriteLine($"CloseSession error: {ex}");
        }
    }

    [RelayCommand]
    private void SendInput()
    {
        if (SelectedSession == null)
        {
            StatusMessage = "No session selected.";
            return;
        }

        if (string.IsNullOrEmpty(InputText))
            return;

        try
        {
            var success = _terminalManager.SendInput(SelectedSession.Id, InputText);
            if (success)
            {
                // Echo the input in the output buffer
                AppendOutput(SelectedSession.Id, $"> {InputText}");
                InputText = "";
            }
            else
            {
                StatusMessage = "Failed to send input. Session may be closed.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Send failed: {ex.Message}";
            Debug.WriteLine($"SendInput error: {ex}");
        }
    }

    [RelayCommand]
    private void ClearOutput()
    {
        if (SelectedSession == null) return;

        lock (_outputLock)
        {
            if (_sessionOutputs.TryGetValue(SelectedSession.Id, out var sb))
                sb.Clear();
        }

        OutputText = "";
    }

    [RelayCommand]
    private void CloseAllSessions()
    {
        _terminalManager.CloseAll();
        Sessions.Clear();

        lock (_outputLock)
        {
            _sessionOutputs.Clear();
        }

        SelectedSession = null;
        OutputText = "";
        StatusMessage = "All sessions closed.";
    }

    private void RefreshSessions()
    {
        var sessions = _terminalManager.GetSessions();
        Sessions.Clear();
        foreach (var session in sessions)
        {
            Sessions.Add(session);
            lock (_outputLock)
            {
                if (!_sessionOutputs.ContainsKey(session.Id))
                    _sessionOutputs[session.Id] = new StringBuilder();
            }
        }

        if (Sessions.Count > 0 && SelectedSession == null)
            SelectedSession = Sessions[0];
    }

    private void AppendOutput(string sessionId, string data)
    {
        lock (_outputLock)
        {
            if (!_sessionOutputs.TryGetValue(sessionId, out var sb))
            {
                sb = new StringBuilder();
                _sessionOutputs[sessionId] = sb;
            }

            sb.AppendLine(data);

            // Trim output if it exceeds max lines
            if (sb.Length > MaxOutputLines * 120)
            {
                var text = sb.ToString();
                var lines = text.Split('\n');
                if (lines.Length > MaxOutputLines)
                {
                    var trimmed = string.Join('\n', lines.Skip(lines.Length - MaxOutputLines));
                    sb.Clear();
                    sb.Append(trimmed);
                }
            }
        }

        // Update display if this is the selected session
        if (SelectedSession?.Id == sessionId)
        {
            lock (_outputLock)
            {
                OutputText = _sessionOutputs[sessionId].ToString();
            }
        }
    }

    private void OnTerminalOutput(object? sender, TerminalOutputEventArgs e)
    {
        var prefix = e.IsError ? "[ERR] " : "";
        AppendOutput(e.SessionId, $"{prefix}{e.Data}");
    }

    private void OnSessionClosed(object? sender, string sessionId)
    {
        var session = Sessions.FirstOrDefault(s => s.Id == sessionId);
        if (session != null)
        {
            Sessions.Remove(session);
            if (SelectedSession?.Id == sessionId)
                SelectedSession = Sessions.LastOrDefault();
        }

        lock (_outputLock)
        {
            _sessionOutputs.Remove(sessionId);
        }
    }
}
