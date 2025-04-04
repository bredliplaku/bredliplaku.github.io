@echo off
:: ===== Elevate to Admin =====
:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    :: Not running as admin — relaunch as admin
    echo Requesting admin permissions...
    powershell -Command "Start-Process '%~f0' -Verb runAs"
    exit /b
)

:: === CONFIGURATION ===
set "ALLOWED_SITE=https://google.com/"
set "WALLPAPER_URL=https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/exam_form/exam_wallpaper.jpg"
set "WALLPAPER_PATH=%TEMP%\exam_wallpaper.jpg"

:: === Download Wallpaper ===
echo Downloading exam wallpaper...
powershell -Command "(New-Object System.Net.WebClient).DownloadFile('%WALLPAPER_URL%', '%WALLPAPER_PATH%')"

:: === Change Wallpaper ===
echo Setting wallpaper...
REG ADD "HKCU\Control Panel\Desktop" /v Wallpaper /t REG_SZ /d "%WALLPAPER_PATH%" /f >nul
RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters ,1 ,True

:: === Enable Firewall and Restrict Traffic ===
echo Enabling firewall and applying rules...
netsh advfirewall set allprofiles state on

:: Resolve IP of allowed domain
for /f "tokens=2 delims=[]" %%a in ('ping -n 1 %ALLOWED_SITE%') do set "SITE_IP=%%a"

netsh advfirewall firewall add rule name="Allow Exam Site" dir=out action=allow remoteip=%SITE_IP% enable=yes
netsh advfirewall firewall add rule name="Block All Other Traffic" dir=out action=block enable=yes

echo.
echo ✅ Lockdown active. Only %ALLOWED_SITE% is allowed.
echo 🖼 Wallpaper set for visual confirmation.
pause
