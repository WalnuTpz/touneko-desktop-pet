param(
    [Parameter(Mandatory = $true)]
    [int]$ParentProcessId
)

$signature = @'
using System;
using System.Collections.Generic;
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

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int dwFlags;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    public static extern int GetWindowLong(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(
        IntPtr hWnd,
        int attribute,
        out int value,
        int valueSize
    );

    public static IntPtr[] GetTopLevelWindows()
    {
        var windows = new List<IntPtr>();
        EnumWindows((handle, _) =>
        {
            windows.Add(handle);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@

Add-Type -TypeDefinition $signature

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

while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    $fullscreenWindows = @()

    foreach ($handle in [FullscreenProbe]::GetTopLevelWindows()) {
        if (
            $handle -eq [IntPtr]::Zero -or
            -not [FullscreenProbe]::IsWindowVisible($handle) -or
            [FullscreenProbe]::IsIconic($handle)
        ) {
            continue
        }

        $cloaked = 0
        [void][FullscreenProbe]::DwmGetWindowAttribute(
            $handle,
            14,
            [ref]$cloaked,
            4
        )
        if ($cloaked -ne 0) {
            continue
        }

        $style = [FullscreenProbe]::GetWindowLong($handle, -16)
        $extendedStyle = [FullscreenProbe]::GetWindowLong($handle, -20)
        if (
            ($style -band 0x40000000) -ne 0 -or
            ($extendedStyle -band 0x00000080) -ne 0 -or
            ($extendedStyle -band 0x00000020) -ne 0 -or
            ($extendedStyle -band 0x08000000) -ne 0
        ) {
            continue
        }

        $windowRect = New-Object FullscreenProbe+RECT
        if (-not [FullscreenProbe]::GetWindowRect($handle, [ref]$windowRect)) {
            continue
        }
        $monitorHandle = [FullscreenProbe]::MonitorFromWindow($handle, 2)
        $monitorInfo = New-Object FullscreenProbe+MONITORINFO
        $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
        if (-not [FullscreenProbe]::GetMonitorInfo($monitorHandle, [ref]$monitorInfo)) {
            continue
        }

        $clientRect = New-Object FullscreenProbe+RECT
        if (-not [FullscreenProbe]::GetClientRect($handle, [ref]$clientRect)) {
            continue
        }
        $clientTopLeft = New-Object FullscreenProbe+POINT
        $clientTopLeft.X = $clientRect.Left
        $clientTopLeft.Y = $clientRect.Top
        $clientBottomRight = New-Object FullscreenProbe+POINT
        $clientBottomRight.X = $clientRect.Right
        $clientBottomRight.Y = $clientRect.Bottom
        if (
            -not [FullscreenProbe]::ClientToScreen($handle, [ref]$clientTopLeft) -or
            -not [FullscreenProbe]::ClientToScreen($handle, [ref]$clientBottomRight)
        ) {
            continue
        }

        $tolerance = 3
        $monitorWidth = $monitorInfo.rcMonitor.Right - $monitorInfo.rcMonitor.Left
        $monitorHeight = $monitorInfo.rcMonitor.Bottom - $monitorInfo.rcMonitor.Top
        $windowWidth = $windowRect.Right - $windowRect.Left
        $windowHeight = $windowRect.Bottom - $windowRect.Top
        $outerCoversMonitor =
            $windowRect.Left -le $monitorInfo.rcMonitor.Left + $tolerance -and
            $windowRect.Top -le $monitorInfo.rcMonitor.Top + $tolerance -and
            $windowRect.Right -ge $monitorInfo.rcMonitor.Right - $tolerance -and
            $windowRect.Bottom -ge $monitorInfo.rcMonitor.Bottom - $tolerance
        $clientCoversMonitor =
            $clientTopLeft.X -le $monitorInfo.rcMonitor.Left + $tolerance -and
            $clientTopLeft.Y -le $monitorInfo.rcMonitor.Top + $tolerance -and
            $clientBottomRight.X -ge $monitorInfo.rcMonitor.Right - $tolerance -and
            $clientBottomRight.Y -ge $monitorInfo.rcMonitor.Bottom - $tolerance
        $fitsSingleMonitor =
            $windowWidth -le $monitorWidth + 32 -and
            $windowHeight -le $monitorHeight + 32
        if (-not ($outerCoversMonitor -and $clientCoversMonitor -and $fitsSingleMonitor)) {
            continue
        }

        $processId = [uint32]0
        [void][FullscreenProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
        if ($processId -eq $ParentProcessId) {
            continue
        }
        $classBuilder = New-Object System.Text.StringBuilder 256
        [void][FullscreenProbe]::GetClassName(
            $handle,
            $classBuilder,
            $classBuilder.Capacity
        )
        $className = $classBuilder.ToString()
        $processName = ""
        try {
            $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
        } catch {
            $processName = ""
        }
        if (
            $ignoredClasses -contains $className -or
            $ignoredProcesses -contains $processName
        ) {
            continue
        }

        $fullscreenWindows += [ordered]@{
            processId = $processId
            handle = $handle.ToInt64()
            className = $className
            processName = $processName
            left = $monitorInfo.rcMonitor.Left
            top = $monitorInfo.rcMonitor.Top
            right = $monitorInfo.rcMonitor.Right
            bottom = $monitorInfo.rcMonitor.Bottom
        }
    }

    $result = [ordered]@{
        fullscreen = $fullscreenWindows.Count -gt 0
        fullscreenWindows = @($fullscreenWindows)
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 750
}
