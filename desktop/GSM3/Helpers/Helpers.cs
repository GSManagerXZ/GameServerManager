using Microsoft.UI;
using Microsoft.UI.Xaml.Media;
using GSM3.Models;

namespace GSM3.Helpers;

public static class StatusHelper
{
    public static string GetStatusText(InstanceStatus status) => status switch
    {
        InstanceStatus.Stopped => "已停止",
        InstanceStatus.Starting => "启动中",
        InstanceStatus.Running => "运行中",
        InstanceStatus.Stopping => "停止中",
        InstanceStatus.Crashed => "已崩溃",
        _ => "未知"
    };

    public static SolidColorBrush GetStatusBrush(InstanceStatus status) => status switch
    {
        InstanceStatus.Running => new SolidColorBrush(Colors.Green),
        InstanceStatus.Starting or InstanceStatus.Stopping => new SolidColorBrush(Colors.Orange),
        InstanceStatus.Crashed => new SolidColorBrush(Colors.Red),
        _ => new SolidColorBrush(Colors.Gray)
    };

    public static string GetInstanceTypeText(InstanceType type) => type switch
    {
        InstanceType.Generic => "通用",
        InstanceType.MinecraftJava => "Minecraft Java",
        InstanceType.MinecraftBedrock => "Minecraft 基岩版",
        _ => "未知"
    };

    public static string GetTaskTypeText(TaskType type) => type switch
    {
        TaskType.Power => "电源操作",
        TaskType.Command => "命令执行",
        TaskType.Backup => "备份",
        TaskType.System => "系统",
        _ => "未知"
    };

    public static string GetUserRoleText(UserRole role) => role switch
    {
        UserRole.Admin => "管理员",
        UserRole.User => "普通用户",
        _ => "未知"
    };
}

public static class PathHelper
{
    public static string GetDataPath()
    {
        var path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "GSM3");
        Directory.CreateDirectory(path);
        return path;
    }

    public static string GetDataFilePath(string fileName)
    {
        return Path.Combine(GetDataPath(), fileName);
    }
}
