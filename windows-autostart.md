# Windows Autostart (Chrome) — Windows 10/11

Start Google Chrome automatically after sign‑in and keep it in the foreground.

Chrome flags used

- `--no-first-run` — Skips first‑run dialogs and the welcome page.
- `--disable-session-crashed-bubble` — Suppresses the "Chrome didn’t shut down correctly" restore prompt.

(Fullscreen and displayed content are handled by the **Tabs Rotator / Slideshow** extension.)

---

## 1) Save the PowerShell launcher

Create folder `C:\Scripts` and save as `C:\Scripts\Launch-Chrome-Focus.ps1`:

```powershell
# Launch-Chrome-Focus.ps1 (minimal)
# Starts Chrome with two flags and brings it to the foreground.

$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $ChromePath)) { Write-Error "Chrome not found at $ChromePath"; exit 1 }

$ArgList = @('--no-first-run','--disable-session-crashed-bubble')
$proc = Start-Process -FilePath $ChromePath -ArgumentList ($ArgList -join ' ') -PassThru

# Wait up to 20s for a Chrome window
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and $proc -and -not $proc.HasExited -and $proc.MainWindowHandle -eq 0) {
  Start-Sleep -Milliseconds 200
  $proc.Refresh()
}

# Bring to foreground
$wshell = New-Object -ComObject WScript.Shell
try { if ($proc -and -not $proc.HasExited) { $null = $wshell.AppActivate($proc.Id) } } catch {}

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

if ($proc -and -not $proc.HasExited -and $proc.MainWindowHandle -ne 0) {
  [Win32]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
  [Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
}

# Re-assert focus a few times in case other apps steal it
1..3 | ForEach-Object {
  Start-Sleep -Seconds 2
  try { if ($proc -and -not $proc.HasExited) { $null = $wshell.AppActivate($proc.Id) } } catch {}
}
```

---

## 2) Task Scheduler

1. Open **Task Scheduler** → Create Task… (not *Create Basic Task*).
2. **General** tab:
   - Name: `Chrome AutoStart`
   - Run only when user is logged on ✔️
   - Run with highest privileges: **leave unchecked** (not required to launch Chrome; can introduce UAC/drag‑and‑drop quirks).
   - Configure for: *Windows 11* (or *Windows 10*)
3. **Triggers** tab → New…
   - Begin the task: *At log on*
   - Delay task for: *30 seconds*
4. **Actions** tab → New…
   - Action: *Start a program*
   - Program/script: `powershell.exe`
   - Add arguments (optional): `-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\Launch-Chrome-Focus.ps1"`
5. **Settings** tab:
   - If the task is already running, then the following rule applies: *Do not start a new instance*
   - Run task as soon as possible after a scheduled start is missed ✔️
6. Click **OK**, then sign out / reboot to test.
