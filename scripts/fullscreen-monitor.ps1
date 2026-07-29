param(
    [Parameter(Mandatory = $true)]
    [int]$ParentProcessId
)

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FullscreenProbe
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int dwFlags;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
}
'@

Add-Type -TypeDefinition $signature

while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    $handle = [FullscreenProbe]::GetForegroundWindow()
    $result = [ordered]@{
        processId = 0
        fullscreen = $false
        left = 0
        top = 0
        right = 0
        bottom = 0
        className = ""
        processName = ""
        eligible = $false
    }

    if (
        $handle -ne [IntPtr]::Zero -and
        [FullscreenProbe]::IsWindowVisible($handle) -and
        -not [FullscreenProbe]::IsIconic($handle)
    ) {
        $windowRect = New-Object FullscreenProbe+RECT
        $processId = [uint32]0
        [void][FullscreenProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
        $classBuilder = New-Object System.Text.StringBuilder 256
        [void][FullscreenProbe]::GetClassName($handle, $classBuilder, $classBuilder.Capacity)
        $className = $classBuilder.ToString()
        $processName = ""
        try {
            $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
        } catch {
            $processName = ""
        }
        $ignoredClasses = @(
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "MultitaskingViewFrame",
            "XamlExplorerHostIslandWindow"
        )
        $ignoredProcesses = @(
            "dwm",
            "SearchHost",
            "ShellExperienceHost",
            "StartMenuExperienceHost",
            "TextInputHost"
        )
        $eligible =
            $ignoredClasses -notcontains $className -and
            $ignoredProcesses -notcontains $processName
        $result.className = $className
        $result.processName = $processName
        $result.eligible = $eligible
        if ([FullscreenProbe]::GetWindowRect($handle, [ref]$windowRect)) {
            $monitorHandle = [FullscreenProbe]::MonitorFromWindow($handle, 2)
            $monitorInfo = New-Object FullscreenProbe+MONITORINFO
            $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
            if ([FullscreenProbe]::GetMonitorInfo($monitorHandle, [ref]$monitorInfo)) {
                $tolerance = 2
                $isFullscreen =
                    $windowRect.Left -le $monitorInfo.rcMonitor.Left + $tolerance -and
                    $windowRect.Top -le $monitorInfo.rcMonitor.Top + $tolerance -and
                    $windowRect.Right -ge $monitorInfo.rcMonitor.Right - $tolerance -and
                    $windowRect.Bottom -ge $monitorInfo.rcMonitor.Bottom - $tolerance
                $result.processId = $processId
                $result.fullscreen = $isFullscreen -and $eligible
                $result.left = $monitorInfo.rcMonitor.Left
                $result.top = $monitorInfo.rcMonitor.Top
                $result.right = $monitorInfo.rcMonitor.Right
                $result.bottom = $monitorInfo.rcMonitor.Bottom
            }
        }
    }

    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 750
}
