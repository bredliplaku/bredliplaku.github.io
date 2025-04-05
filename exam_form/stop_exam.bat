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

echo ===== EXAM MODE CLEANUP =====
echo.
echo Removing firewall rules...

:: Remove the firewall rules created by start_exam.bat
netsh advfirewall firewall delete rule name="Allow Exam Site"
netsh advfirewall firewall delete rule name="Allow Google APIs"
netsh advfirewall firewall delete rule name="Allow Google Accounts"
netsh advfirewall firewall delete rule name="Block All Other Traffic"

:: Reset firewall to default state
echo Resetting firewall to default state...
netsh advfirewall reset

:: Reset wallpaper to default
echo Resetting wallpaper...
reg delete "HKCU\Control Panel\Desktop" /v Wallpaper /f >nul 2>&1
RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters ,1 ,True

:: Clean up temporary files
echo Cleaning up temporary files...
del "%TEMP%\exam_wallpaper.jpg" >nul 2>&1

echo.
echo ✅ Exam mode disabled. Normal computer access has been restored.
echo ✅ Firewall reset to default settings.
echo ✅ Wallpaper reset.
echo.
echo You can now close this window.
pause