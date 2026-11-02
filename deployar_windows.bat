@echo off
set /p PROJECT_ID=Ingrese el ID del proyecto Firebase: 
firebase deploy --project %PROJECT_ID% --only firestore,hosting
if errorlevel 1 pause & exit /b 1
echo.
echo Sitio publicado en https://%PROJECT_ID%.web.app
pause
