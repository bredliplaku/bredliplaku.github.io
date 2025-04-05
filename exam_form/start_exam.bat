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

:: Allow GitHub domains for exam site
netsh advfirewall firewall add rule name="Allow GitHub for Exam" dir=out action=allow remoteip=192.30.252.0/22,185.199.108.0/22,140.82.112.0/20,143.55.64.0/20 enable=yes

:: Allow Google domains for authentication and sheets
netsh advfirewall firewall add rule name="Allow Google Domains" dir=out action=allow remoteip=172.217.0.0/19,74.125.0.0/16,64.233.160.0/19,108.177.0.0/17,34.192.0.0/10,35.184.0.0/13,35.192.0.0/14,35.196.0.0/15,35.198.0.0/16,35.199.0.0/17,35.235.0.0/16 enable=yes

:: Allow Cloudflare CDN (for libraries)
netsh advfirewall firewall add rule name="Allow Cloudflare CDN" dir=out action=allow remoteip=104.16.0.0/12,162.158.0.0/15,172.64.0.0/13,131.0.72.0/22 enable=yes

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