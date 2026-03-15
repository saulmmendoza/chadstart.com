/**
 * hello.cpp — ChadStart C++ function
 * Reads the event JSON from stdin and returns a greeting.
 *
 * Runtime: c++
 * Trigger: GET /api/fn/greet/cpp (public)
 */
#include <iostream>
#include <string>

int main() {
    // Consume stdin (ChadStart passes the serialized event as JSON)
    std::string line;
    while (std::getline(std::cin, line)) {}

    std::cout << "{\"message\":\"Hello, World!\",\"runtime\":\"c++\"}" << std::endl;
    return 0;
}
