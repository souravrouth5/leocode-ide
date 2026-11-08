cmake_minimum_required(VERSION 3.22.1)
project(leocodepty C)

add_library(leocodepty SHARED pty.c)

target_compile_options(leocodepty PRIVATE -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(leocodepty log)
