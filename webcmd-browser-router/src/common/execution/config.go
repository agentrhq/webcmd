package execution

import (
	"io"

	"github.com/bdoerfchen/webcmd/src/common/config"
)

type Config struct {
	Command string            // Command file or name on PATH
	Args    []string          // Process args
	Env     map[string]string // Raw environment variable map
	Stdin   io.Reader         // Stdin stream. Can be nil to use /dev/null
}

func ConfigFromRoute(route *config.Route) Config {
	// Build exec config
	execConfig := Config{
		Env:   make(map[string]string),
		Stdin: nil,
	}

	switch {
	case route.Exec.Proc != nil:
		execConfig.Command = route.Exec.Proc.Path
		execConfig.Args = route.Exec.Proc.Args
	case route.Exec.Shell != nil:
		execConfig.Command = route.Exec.Shell.Command
	default:
		// Should not be called, as the app detects this case on config check and exits
		panic("missing exec config")
	}
	return execConfig
}
