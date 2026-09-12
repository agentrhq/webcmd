package shellexecuter

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/execution"
	"github.com/bdoerfchen/webcmd/src/common/process"
)

type shellExecuter struct {
	pool *shellPool
}

func New(size uint, template process.Template) *shellExecuter {
	return &shellExecuter{
		pool: NewPool(size, template),
	}
}

func (e *shellExecuter) Execute(ctx context.Context, config execution.Config) (proc *process.Process, exitCode int, err error) {
	// Get process from pool
	shell, err := e.pool.Take(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("taking from pool failed: %w", err)
	}

	// Env exports prepended to the command
	var envExportCmd strings.Builder
	for key, value := range config.Env {
		envExportCmd.WriteString(fmt.Sprintf("export %s=\"%s\"; ", key, value))
	}

	// - Body preparation | A bit more complicated here as everything runs over stdin
	// 1. Write provided shell command (with env variables exports)
	shell.StdIn.Write([]byte(envExportCmd.String() + config.Command))
	// 2. Write body (in next line)
	if config.Stdin != nil {
		shell.StdIn.Write([]byte("\n"))
		io.Copy(shell.StdIn, config.Stdin)
	}
	// 3. Close input stream to signal shell to start
	shell.StdIn.Close()

	// Wait for result
	err = shell.Proc.Wait()
	if err != nil {
		if exitErr, isExitErr := err.(*exec.ExitError); isExitErr {
			return shell, exitErr.ExitCode(), nil
		}

		return nil, 0, fmt.Errorf("error during execution: %w", err)
	}

	return shell, 0, nil
}

func (e *shellExecuter) Describe() (mode execution.ExecMode, attributes []any) {
	return execution.ModeShell, []any{slog.String("shell", e.pool.template.Command), slog.Int("size", e.pool.Capacity())}
}
