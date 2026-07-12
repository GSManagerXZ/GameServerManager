using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class SchedulerPage : Page
{
    public SchedulerPage()
    {
        InitializeComponent();
    }

    private async void CreateTaskButton_Click(object sender, RoutedEventArgs e)
    {
        CreateTaskDialog.Title = "创建定时任务";
        CreateTaskDialog.PrimaryButtonText = "创建";
        ClearDialogFields();
        CreateTaskDialog.XamlRoot = XamlRoot;
        await CreateTaskDialog.ShowAsync();
    }

    private async void EditTaskButton_Click(object sender, RoutedEventArgs e)
    {
        if (TaskListView.SelectedItem == null)
        {
            ShowStatus("请先选择要编辑的任务", InfoBarSeverity.Warning);
            return;
        }

        CreateTaskDialog.Title = "编辑定时任务";
        CreateTaskDialog.PrimaryButtonText = "保存";
        CreateTaskDialog.XamlRoot = XamlRoot;
        await CreateTaskDialog.ShowAsync();
    }

    private void DeleteTaskButton_Click(object sender, RoutedEventArgs e)
    {
        if (TaskListView.SelectedItem == null)
        {
            ShowStatus("请先选择要删除的任务", InfoBarSeverity.Warning);
            return;
        }

        // TODO: Confirm and delete selected task
    }

    private void RunNowButton_Click(object sender, RoutedEventArgs e)
    {
        if (TaskListView.SelectedItem == null)
        {
            ShowStatus("请先选择要执行的任务", InfoBarSeverity.Warning);
            return;
        }

        // TODO: Execute selected task immediately
    }

    private void CreateTaskDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (string.IsNullOrWhiteSpace(TaskNameTextBox.Text))
        {
            args.Cancel = true;
            ShowStatus("请输入任务名称", InfoBarSeverity.Error);
            return;
        }

        if (string.IsNullOrWhiteSpace(CronExpressionTextBox.Text))
        {
            args.Cancel = true;
            ShowStatus("请输入 Cron 表达式", InfoBarSeverity.Error);
            return;
        }

        // TODO: Save the task
    }

    private void ActionComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (CustomCommandTextBox == null) return;

        var selectedItem = ActionComboBox.SelectedItem as ComboBoxItem;
        CustomCommandTextBox.Visibility =
            selectedItem?.Content?.ToString() == "自定义命令"
                ? Visibility.Visible
                : Visibility.Collapsed;
    }

    private void ClearDialogFields()
    {
        TaskNameTextBox.Text = string.Empty;
        InstanceComboBox.SelectedIndex = -1;
        ActionComboBox.SelectedIndex = -1;
        CronExpressionTextBox.Text = string.Empty;
        CustomCommandTextBox.Text = string.Empty;
        CustomCommandTextBox.Visibility = Visibility.Collapsed;
    }

    private void ShowStatus(string message, InfoBarSeverity severity)
    {
        StatusInfoBar.Message = message;
        StatusInfoBar.Severity = severity;
        StatusInfoBar.IsOpen = true;
    }
}
