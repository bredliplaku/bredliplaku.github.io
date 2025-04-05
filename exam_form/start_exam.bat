@echo off
:: ===== Elevate to Admin =====
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

:: === CONFIGURATION ===
set "ALLOWED_SITE=https://bredliplaku.github.io/exam_form/"
set "WALLPAPER_URL=https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/exam_form/exam_wallpaper.jpg"
set "WALLPAPER_PATH=%TEMP%\exam_wallpaper.jpg"

:: === Download Wallpaper ===
powershell -Command "(New-Object System.Net.WebClient).DownloadFile('%WALLPAPER_URL%', '%WALLPAPER_PATH%')"

:: === Change Wallpaper ===
REG ADD "HKCU\Control Panel\Desktop" /v Wallpaper /t REG_SZ /d "%WALLPAPER_PATH%" /f >nul
RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters ,1 ,True

:: === Firewall Configuration ===
netsh advfirewall set allprofiles state on

:: Allow DNS
netsh advfirewall firewall add rule name="Allow DNS" dir=out protocol=UDP remoteport=53 action=allow

:: Allow HTTP/HTTPS
netsh advfirewall firewall add rule name="Allow Web" dir=out protocol=TCP remoteport=80,443 action=allow

:: Block all other outbound traffic
netsh advfirewall firewall add rule name="Block All Other Traffic" dir=out action=block enable=yes

:: === Open Exam Page ===
start "" "%ALLOWED_SITE%"

echo ✅ Lockdown active. Only web access is allowed.
echo 🖼 Wallpaper set for visual confirmation.
pause