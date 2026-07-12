namespace GSM3.Services;

using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using GSM3.Models;

public class SteamCMDManager
{
    private const string SteamCMDUrl = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string DefaultSteamCMDDir = Path.Combine(DataDir, "steamcmd");

    private readonly ConfigManager _configManager;
    private static readonly HttpClient HttpClient = new();

    public event EventHandler<string>? OnOutput;

    public SteamCMDManager(ConfigManager configManager)
    {
        _configManager = configManager;
    }

    public string GetExecutablePath()
    {
        var config = _configManager.GetConfig();
        var dir = string.IsNullOrEmpty(config.SteamCMD.InstallPath)
            ? DefaultSteamCMDDir
            : config.SteamCMD.InstallPath;
        return Path.Combine(dir, "steamcmd.exe");
    }

    public bool CheckInstalled()
    {
        var exePath = GetExecutablePath();
        var installed = File.Exists(exePath);

        // Sync config state
        var config = _configManager.GetConfig();
        if (config.SteamCMD.IsInstalled != installed)
        {
            _ = _configManager.UpdateConfigAsync(c => c.SteamCMD.IsInstalled = installed);
        }

        return installed;
    }

    public async Task SetPathAsync(string path)
    {
        await _configManager.UpdateConfigAsync(c => c.SteamCMD.InstallPath = path);
    }

    public async Task<(bool Success, string? Error)> InstallAsync(IProgress<double>? progress = null)
    {
        try
        {
            var installDir = Path.GetDirectoryName(GetExecutablePath()) ?? DefaultSteamCMDDir;
            Directory.CreateDirectory(installDir);

            var zipPath = Path.Combine(installDir, "steamcmd.zip");

            Log("Downloading SteamCMD...");

            // Download with progress
            using (var response = await HttpClient.GetAsync(SteamCMDUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();
                var totalBytes = response.Content.Headers.ContentLength ?? -1;

                using var contentStream = await response.Content.ReadAsStreamAsync();
                using var fileStream = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None);

                var buffer = new byte[81920];
                long totalRead = 0;
                int bytesRead;

                while ((bytesRead = await contentStream.ReadAsync(buffer)) > 0)
                {
                    await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead));
                    totalRead += bytesRead;

                    if (totalBytes > 0)
                        progress?.Report((double)totalRead / totalBytes);
                }
            }

            Log("Extracting SteamCMD...");
            ZipFile.ExtractToDirectory(zipPath, installDir, overwriteFiles: true);

            // Cleanup zip
            if (File.Exists(zipPath))
                File.Delete(zipPath);

            // Run initial update (SteamCMD needs to update itself on first run)
            Log("Running initial SteamCMD update...");
            var updateResult = await RunSteamCMDAsync("+quit");
            if (!updateResult.Success)
                return (false, $"SteamCMD initial update failed: {updateResult.Error}");

            // Update config
            await _configManager.UpdateConfigAsync(c =>
            {
                c.SteamCMD.IsInstalled = true;
                c.SteamCMD.InstallPath = installDir;
            });

            Log("SteamCMD installed successfully.");
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"Installation failed: {ex.Message}");
        }
    }

    public async Task<(bool Success, string? Error)> UpdateGameAsync(
        int appId,
        string installDir,
        string? username = null,
        string? password = null,
        string? betaBranch = null,
        bool validate = true)
    {
        if (!CheckInstalled())
            return (false, "SteamCMD is not installed.");

        Directory.CreateDirectory(installDir);

        // Build command arguments
        var args = new List<string>();

        if (!string.IsNullOrEmpty(username))
        {
            args.Add($"+login {username} {password ?? ""}");
        }
        else
        {
            args.Add("+login anonymous");
        }

        args.Add($"+force_install_dir \"{installDir}\"");

        var appUpdateCmd = $"+app_update {appId}";
        if (!string.IsNullOrEmpty(betaBranch))
            appUpdateCmd += $" -beta {betaBranch}";
        if (validate)
            appUpdateCmd += " validate";
        args.Add(appUpdateCmd);

        args.Add("+quit");

        var commandLine = string.Join(" ", args);
        Log($"Updating app {appId}...");

        return await RunSteamCMDAsync(commandLine);
    }

    // ── Internal ───────────────────────────────────────────────

    private async Task<(bool Success, string? Error)> RunSteamCMDAsync(string arguments)
    {
        try
        {
            var exePath = GetExecutablePath();
            var psi = new ProcessStartInfo
            {
                FileName = exePath,
                Arguments = arguments,
                WorkingDirectory = Path.GetDirectoryName(exePath) ?? "",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

            process.OutputDataReceived += (_, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    Log(e.Data);
            };

            process.ErrorDataReceived += (_, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    Log($"[ERR] {e.Data}");
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
                return (false, $"SteamCMD exited with code {process.ExitCode}");

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private void Log(string message)
    {
        Debug.WriteLine($"[SteamCMD] {message}");
        OnOutput?.Invoke(this, message);
    }
}
