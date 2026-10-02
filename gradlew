#!/bin/sh
#
# Gradle start up script (generated wrapper).
#
APP_BASE_NAME=${0##*/}
APP_HOME=$(cd "${0%/*}" >/dev/null && pwd -P)

CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"

if command -v java >/dev/null 2>&1; then
  JAVACMD=java
else
  echo "ERROR: JAVA_HOME is not set and no 'java' command could be found." >&2
  exit 1
fi

exec "$JAVACMD" -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
