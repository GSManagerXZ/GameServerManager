using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace GSM3.Pages;

public sealed partial class TerminalPage : Page
{
    public TerminalPage()
    {
        InitializeComponent();
        TerminalOutput.Text = "GSM3 终端已就绪...\n> ";
    }

    private void SendCommand()
    {
        var command = CommandInput.Text;
        if (string.IsNullOrWhiteSpace(command))
            return;

        TerminalOutput.Text += command + "\n";
        TerminalOutput.Text += "> ";
        CommandInput.Text = string.Empty;

        // Scroll to bottom
        TerminalScrollViewer.UpdateLayout();
        TerminalScrollViewer.ChangeView(null, TerminalScrollViewer.ScrollableHeight, null);
    }

    private void CommandInput_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            SendCommand();
            e.Handled = true;
        }
    }

    private void SendButton_Click(object sender, RoutedEventArgs e)
    {
        SendCommand();
    }

    private void NewSessionButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement new session creation
    }

    private void CloseSessionButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement session closing
    }

    private void ClearScreenButton_Click(object sender, RoutedEventArgs e)
    {
        TerminalOutput.Text = "> ";
    }
}
