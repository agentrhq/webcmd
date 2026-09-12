package version

import (
	"fmt"
	"runtime/debug"
)

const MAJOR = "0"
const MINOR = "3"
const PATCH = "0"

func Full() string {
	return fmt.Sprintf("%s.%s.%s", MAJOR, MINOR, PATCH)
}

func CommitSha() (string, error) {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			if setting.Key == "vcs.revision" {
				return setting.Value, nil
			}
		}
	}

	return "", fmt.Errorf("vcs revision not embedded")
}
