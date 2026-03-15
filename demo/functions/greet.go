// greet.go — ChadStart Go function
// Returns a greeting from the Go runtime.
//
// Runtime: go
// Trigger: GET /api/fn/greet/go (public)
//
// ChadStart passes event JSON via stdin; result must be printed as JSON to stdout.

package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type Event struct {
	Query map[string]string `json:"query"`
}

func main() {
	var evt Event
	dec := json.NewDecoder(os.Stdin)
	// ignore decode errors — event may be wrapped in {"event":...}
	_ = dec.Decode(&evt)

	name := "World"
	if evt.Query != nil {
		if n, ok := evt.Query["name"]; ok && n != "" {
			name = n
		}
	}

	result := map[string]string{
		"message": fmt.Sprintf("Hello, %s!", name),
		"runtime": "go",
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
