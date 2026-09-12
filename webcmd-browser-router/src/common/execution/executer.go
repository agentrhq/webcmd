package execution

import (
	"context"

	"github.com/bdoerfchen/webcmd/src/common/process"
)

type Executer interface {
	// Run a command and return its output and status.
	Execute(ctx context.Context, config Config) (result *process.Process, exitCode int, err error)
	// Get information about executer. The attributes can be any meaningful information about the executer.
	Describe() (mode ExecMode, attributes []any)
}
