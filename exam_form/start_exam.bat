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
set "ALLOWED_SITE=https://bredliplaku.github.io/exam_form/"
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
for /f "tokens=2 delims=[]" %%a in ('ping -n 1 github.io') do set "SITE_IP=%%a"

:: Allow access to exam site (GitHub Pages)
netsh advfirewall firewall add rule name="Allow Exam Site" dir=out action=allow remoteip=%SITE_IP% enable=yes

:: Allow Google APIs for authentication and sheet access
for /f "tokens=2 delims=[]" %%a in ('ping -n 1 googleapis.com') do set "GOOGLE_API_IP=%%a"
netsh advfirewall firewall add rule name="Allow Google APIs" dir=out action=allow remoteip=%GOOGLE_API_IP% enable=yes

:: Allow Google Accounts for authentication
for /f "tokens=2 delims=[]" %%a in ('ping -n 1 accounts.google.com') do set "GOOGLE_ACCOUNTS_IP=%%a"
netsh advfirewall firewall add rule name="Allow Google Accounts" dir=out action=allow remoteip=%GOOGLE_ACCOUNTS_IP% enable=yes

:: Block all other traffic
netsh advfirewall firewall add rule name="Block All Other Traffic" dir=out action=block enable=yes

:: === Open Exam Page ===
echo Opening exam submission page...
start "" "%ALLOWED_SITE%"

echo.
echo ✅ Lockdown active. Only %ALLOWED_SITE% is allowed.
echo 🖼 Wallpaper set for visual confirmation.
echo.
echo Please do not close this window until your exam is complete.
echo When you've submitted your exam, your instructor will tell you how to exit exam mode.
pause