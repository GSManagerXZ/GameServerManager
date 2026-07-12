namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class SchedulerViewModel : ObservableObject
{
    private readonly SchedulerManager _schedulerManager;
    private readonly InstanceManager _instanceManager;

    public ObservableCollection<ScheduledTask> Tasks { get; } = new();
    public ObservableCollection<Instance> Instances { get; } = new();

    [ObservableProperty] private ScheduledTask? selectedTask;
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;

    // Create/Edit form fields
    [ObservableProperty] private string editName = "";
    [ObservableProperty] private string editInstanceId = "";
    [ObservableProperty] private TaskType editTaskType = TaskType.Power;
    [ObservableProperty] private string editCronExpression = "0 * * * *";
    [ObservableProperty] private bool editEnabled = true;
    [ObservableProperty] private PowerAction editPowerAction = PowerAction.Restart;
    [ObservableProperty] private string editCommand = "";
    [ObservableProperty] private string editSystemAction = "";
    [ObservableProperty] private bool isEditing;

    public SchedulerViewModel()
    {
        _schedulerManager = ServiceLocator.GetService<SchedulerManager>();
        _instanceManager = ServiceLocator.GetService<InstanceManager>();
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await _schedulerManager.InitializeAsync();
            await _instanceManager.InitializeAsync();

            var instances = _instanceManager.GetInstances();
            Instances.Clear();
            foreach (var inst in instances)
                Instances.Add(inst);

            await RefreshTasksAsync();
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task RefreshTasksAsync()
    {
        var tasks = _schedulerManager.GetTasks();
        Tasks.Clear();
        foreach (var task in tasks.OrderBy(t => t.Name))
            Tasks.Add(task);

        StatusMessage = $"{Tasks.Count} scheduled task(s).";
    }

    [RelayCommand]
    private async Task CreateTaskAsync()
    {
        if (string.IsNullOrWhiteSpace(EditName))
        {
            StatusMessage = "Task name is required.";
            return;
        }

        if (string.IsNullOrWhiteSpace(EditCronExpression))
        {
            StatusMessage = "Cron expression is required.";
            return;
        }

        if (string.IsNullOrWhiteSpace(EditInstanceId))
        {
            StatusMessage = "Please select an instance.";
            return;
        }

        IsLoading = true;
        try
        {
            var task = new ScheduledTask
            {
                Name = EditName.Trim(),
                InstanceId = EditInstanceId,
                Type = EditTaskType,
                CronExpression = EditCronExpression.Trim(),
                Enabled = EditEnabled,
                PowerActionType = EditTaskType == TaskType.Power ? EditPowerAction : null,
                Command = EditTaskType == TaskType.Command ? EditCommand.Trim() : null,
                SystemAction = EditTaskType == TaskType.System ? EditSystemAction.Trim() : null
            };

            await _schedulerManager.CreateTaskAsync(task);
            ClearEditFields();
            await RefreshTasksAsync();
            StatusMessage = $"Task '{task.Name}' created.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to create task: {ex.Message}";
            Debug.WriteLine($"CreateTask error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task EditTaskAsync()
    {
        if (SelectedTask == null || string.IsNullOrWhiteSpace(EditName))
        {
            StatusMessage = "No task selected or name is empty.";
            return;
        }

        IsLoading = true;
        try
        {
            SelectedTask.Name = EditName.Trim();
            SelectedTask.InstanceId = EditInstanceId;
            SelectedTask.Type = EditTaskType;
            SelectedTask.CronExpression = EditCronExpression.Trim();
            SelectedTask.Enabled = EditEnabled;
            SelectedTask.PowerActionType = EditTaskType == TaskType.Power ? EditPowerAction : null;
            SelectedTask.Command = EditTaskType == TaskType.Command ? EditCommand.Trim() : null;
            SelectedTask.SystemAction = EditTaskType == TaskType.System ? EditSystemAction.Trim() : null;

            var updated = await _schedulerManager.UpdateTaskAsync(SelectedTask);
            if (updated != null)
            {
                await RefreshTasksAsync();
                StatusMessage = $"Task '{updated.Name}' updated.";
            }
            else
            {
                StatusMessage = "Failed to update task.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Update failed: {ex.Message}";
            Debug.WriteLine($"EditTask error: {ex}");
        }
        finally
        {
            IsLoading = false;
            IsEditing = false;
        }
    }

    [RelayCommand]
    private async Task DeleteTaskAsync()
    {
        if (SelectedTask == null)
        {
            StatusMessage = "No task selected.";
            return;
        }

        IsLoading = true;
        try
        {
            var name = SelectedTask.Name;
            var success = await _schedulerManager.DeleteTaskAsync(SelectedTask.Id);
            if (success)
            {
                SelectedTask = null;
                await RefreshTasksAsync();
                StatusMessage = $"Task '{name}' deleted.";
            }
            else
            {
                StatusMessage = $"Failed to delete task '{name}'.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Delete failed: {ex.Message}";
            Debug.WriteLine($"DeleteTask error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task ToggleTaskAsync()
    {
        if (SelectedTask == null)
        {
            StatusMessage = "No task selected.";
            return;
        }

        try
        {
            var success = await _schedulerManager.ToggleTaskAsync(SelectedTask.Id);
            if (success)
            {
                await RefreshTasksAsync();
                // Find the updated task to check its state
                var updatedTask = Tasks.FirstOrDefault(t => t.Id == SelectedTask.Id);
                var state = updatedTask?.Enabled == true ? "enabled" : "disabled";
                StatusMessage = $"Task '{SelectedTask.Name}' {state}.";
            }
            else
            {
                StatusMessage = "Failed to toggle task.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Toggle failed: {ex.Message}";
            Debug.WriteLine($"ToggleTask error: {ex}");
        }
    }

    [RelayCommand]
    private async Task ExecuteNowAsync()
    {
        if (SelectedTask == null)
        {
            StatusMessage = "No task selected.";
            return;
        }

        StatusMessage = $"Executing '{SelectedTask.Name}'...";
        try
        {
            var success = await _schedulerManager.ExecuteNowAsync(SelectedTask.Id);
            if (success)
            {
                await RefreshTasksAsync();
                StatusMessage = $"Task '{SelectedTask.Name}' executed.";
            }
            else
            {
                StatusMessage = $"Failed to execute task '{SelectedTask.Name}'.";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Execution failed: {ex.Message}";
            Debug.WriteLine($"ExecuteNow error: {ex}");
        }
    }

    public void BeginEdit()
    {
        if (SelectedTask == null) return;

        EditName = SelectedTask.Name;
        EditInstanceId = SelectedTask.InstanceId;
        EditTaskType = SelectedTask.Type;
        EditCronExpression = SelectedTask.CronExpression;
        EditEnabled = SelectedTask.Enabled;
        EditPowerAction = SelectedTask.PowerActionType ?? PowerAction.Restart;
        EditCommand = SelectedTask.Command ?? "";
        EditSystemAction = SelectedTask.SystemAction ?? "";
        IsEditing = true;
    }

    public void BeginCreate()
    {
        ClearEditFields();
        SelectedTask = null;
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
        EditInstanceId = "";
        EditTaskType = TaskType.Power;
        EditCronExpression = "0 * * * *";
        EditEnabled = true;
        EditPowerAction = PowerAction.Restart;
        EditCommand = "";
        EditSystemAction = "";
        IsEditing = false;
    }
}
