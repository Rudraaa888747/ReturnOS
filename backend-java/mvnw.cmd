@echo off
setlocal
if not exist "%JAVA_HOME%\bin\java.exe" (
  rem Java is installed by the desktop environment but its JAVA_HOME points at
  rem a bin directory; use the discovered JDK home for this local wrapper.
  set "JAVA_HOME=C:\Program Files\Java\jdk-24"
)
set "MAVEN_HOME=%~dp0.maven\apache-maven-3.9.11"
if not exist "%MAVEN_HOME%\bin\mvn.cmd" (
  echo Maven distribution is missing. Restore backend-java\.maven\apache-maven-3.9.11 or install Maven 3.9+.
  exit /b 1
)
pushd "%~dp0"
call "%MAVEN_HOME%\bin\mvn.cmd" %*
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
