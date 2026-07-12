namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class InstancesViewModel : ObservableObject
{
    private readonly InstanceManager _instanceManager;

    public ObservableCollection<Instance> Instances { get; } = new();

    [ObservableProperty] private Instance? selectedInstance;
    [ObservableProperty] private bool isLoading;
    [ObservableProperty] private string statusMessage = "";

    // Create/Edit form fields
    [ObservableProperty] private string editName = "";
    [ObservableProperty] private string editDescription = "";
    [ObservableProperty] private string editWorkingDirectory = "";
    [ObservableProperty] private string editStartCommand = "";
    [ObservableProperty] private string editProgramPath = "";
    [ObservableProperty] private InstanceType editType = InstanceType.Generic;
    [ObservableProperty] private StopCommand editStopCommandType = StopCommand.CtrlC;
    [ObservableProperty] private bool editAutoStart;
    [ObservableProperty] private bool editEnableStreamForward;
    [ObservableProperty] private bool isEditing;

    public InstancesViewModel()
    {
        _instanceManager = ServiceLocator.GetService<InstanceManager>();
        _instanceManager.OnInstanceStatusChanged += OnInstanceStatusChanged;
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await _instanceManager.InitializeAsync();
            await RefreshInstancesAsync();
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task RefreshInstancesAsync()
    {
        var instances = _instanceManager.GetInstances();
        Instances.Clear();
        foreach (var inst in instances)
            Instances.Add(inst);
        StatusMessage = $"{instances.Count} instance(s) loaded";
    }

    [RelayCommand]
    private async Task CreateInstanceAsync()
    {
        if (string.IsNullOrWhiteSpace(EditName))
        {
            StatusMessage = "Instance name is required.";
            return;
        }

        IsLoading = true;
        try
        {
            var instance = new Instance
            {
                Name = EditName.Trim(),
                Description = EditDescription.Trim(),
                WorkingDirectory = EditWorkingDirectory.Trim(),
                StartCommand = EditStartCommand.Trim(),
                ProgramPath = EditProgramPath.Trim(),
                Type = EditType,
                StopCommandType = EditStopCommandType,
                AutoStart = EditAutoStart,
                EnableStreamForward = EditEnableStreamForward
            };

            await _instanceManager.CreateInstanceAsync(instance);
            ClearEditFields();
            await RefreshInstancesAsync();
            StatusMessage = $"Instance '{instance.Name}' created.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to create instance: {ex.Message}";
            Debug.WriteLine($"CreateInstance error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task DeleteInstanceAsync()
    {
        if (SelectedInstance == null)
        {
            StatusMessage = "No instance selected.";
            return;
        }

        IsLoading = true;
        try
        {
            var name = SelectedInstance.Name;
            var success = await _instanceManager.DeleteInstanceAsync(SelectedInstance.Id);
            if (success)
            {
                SelectedInstance = null;
                await RefreshInstancesAsync();
                StatusMessage = $"Instance '{name}' deleted.";
            }
            else
            {
                StatusMessage = $"Failed to delete instance '{name}'.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Delete failed: {ex.Message}";
            Debug.WriteLine($"DeleteInstance error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task StartInstanceAsync()
    {
        if (SelectedInstance == null)
        {
            StatusMessage = "No instance selected.";
            return;
        }

        StatusMessage = $"Starting '{SelectedInstance.Name}'...";
        try
        {
            var success = await _instanceManager.StartInstanceAsync(SelectedInstance.Id);
            StatusMessage = success
                ? $"Instance '{SelectedInstance.Name}' started."
                : $"Failed to start '{SelectedInstance.Name}'.";
            await RefreshInstancesAsync();
        }
        catch (Exception ex)
        {
            StatusMessage = $"Start failed: {ex.Message}";
            Debug.WriteLine($"StartInstance error: {ex}");
        }
    }

    [RelayCommand]
    private async Task StopInstanceAsync()
    {
        if (SelectedInstance == null)
        {
            StatusMessage = "No instance selected.";
            return;
        }

        StatusMessage = $"Stopping '{SelectedInstance.Name}'...";
        try
        {
            var success = await _instanceManager.StopInstanceAsync(SelectedInstance.Id);
            StatusMessage = success
                ? $"Instance '{SelectedInstance.Name}' stopped."
                : $"Failed to stop '{SelectedInstance.Name}'.";
            await RefreshInstancesAsync();
        }
        catch (Exception ex)
        {
            StatusMessage = $"Stop failed: {ex.Message}";
            Debug.WriteLine($"StopInstance error: {ex}");
        }
    }

    [RelayCommand]
    private async Task RestartInstanceAsync()
    {
        if (SelectedInstance == null)
        {
            StatusMessage = "No instance selected.";
            return;
        }

        StatusMessage = $"Restarting '{SelectedInstance.Name}'...";
        try
        {
            var success = await _instanceManager.RestartInstanceAsync(SelectedInstance.Id);
            StatusMessage = success
                ? $"Instance '{SelectedInstance.Name}' restarted."
                : $"Failed to restart '{SelectedInstance.Name}'.";
            await RefreshInstancesAsync();
        }
        catch (Exception ex)
        {
            StatusMessage = $"Restart failed: {ex.Message}";
            Debug.WriteLine($"RestartInstance error: {ex}");
        }
    }

    [RelayCommand]
    private async Task SaveInstanceAsync()
    {
        if (SelectedInstance == null || string.IsNullOrWhiteSpace(EditName))
        {
            StatusMessage = "No instance selected or name is empty.";
            return;
        }

        IsLoading = true;
        try
        {
            SelectedInstance.Name = EditName.Trim();
            SelectedInstance.Description = EditDescription.Trim();
            SelectedInstance.WorkingDirectory = EditWorkingDirectory.Trim();
            SelectedInstance.StartCommand = EditStartCommand.Trim();
            SelectedInstance.ProgramPath = EditProgramPath.Trim();
            SelectedInstance.Type = EditType;
            SelectedInstance.StopCommandType = EditStopCommandType;
            SelectedInstance.AutoStart = EditAutoStart;
            SelectedInstance.EnableStreamForward = EditEnableStreamForward;

            var updated = await _instanceManager.UpdateInstanceAsync(SelectedInstance);
            if (updated != null)
            {
                await RefreshInstancesAsync();
                StatusMessage = $"Instance '{updated.Name}' updated.";
            }
            else
            {
                StatusMessage = "Failed to update instance.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Save failed: {ex.Message}";
            Debug.WriteLine($"SaveInstance error: {ex}");
        }
        finally
        {
            IsLoading = false;
            IsEditing = false;
        }
    }

    public void BeginEdit()
    {
        if (SelectedInstance == null) return;

        EditName = SelectedInstance.Name;
        EditDescription = SelectedInstance.Description;
        EditWorkingDirectory = SelectedInstance.WorkingDirectory;
        EditStartCommand = SelectedInstance.StartCommand;
        EditProgramPath = SelectedInstance.ProgramPath;
        EditType = SelectedInstance.Type;
        EditStopCommandType = SelectedInstance.StopCommandType;
        EditAutoStart = SelectedInstance.AutoStart;
        EditEnableStreamForward = SelectedInstance.EnableStreamForward;
        IsEditing = true;
    }

    public void CancelEdit()
    {
        ClearEditFields();
        IsEditing = false;
    }

    private void ClearEditFields()
    {
        EditName = "";
        EditDescription = "";
        EditWorkingDirectory = "";
        EditStartCommand = "";
        EditProgramPath = "";
        EditType = InstanceType.Generic;
        EditStopCommandType = StopCommand.CtrlC;
        EditAutoStart = false;
        EditEnableStreamForward = false;
        IsEditing = false;
    }

    private void OnInstanceStatusChanged(object? sender, InstanceStatusEventArgs e)
    {
        // Update the instance status in the collection
        var instance = Instances.FirstOrDefault(i => i.Id == e.InstanceId);
        if (instance != null)
        {
            instance.Status = e.NewStatus;
            // Trigger UI refresh by re-reading from service
            _ = RefreshInstancesAsync();
        }
    }
}
