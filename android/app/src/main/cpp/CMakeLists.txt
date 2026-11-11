cmake_minimum_required(VERSION 3.22.1)
project(leocodepty C)

add_library(leocodepty SHARED pty.c)

target_compile_options(leocodepty PRIVATE -Wall -Wextra -Wno-unused-parameter)
# 16 KB page-size devices (Android 15+). NDK r28 already defaults to this;
# stating it explicitly keeps the intent when the pinned NDK moves.
target_link_options(leocodepty PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(leocodepty log)
