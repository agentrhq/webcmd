package procexecuter

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/bdoerfchen/webcmd/src/common/execution"
	"github.com/bdoerfchen/webcmd/src/common/process"
)

type procExecuter struct{}

func New() *procExecuter {
	return &procExecuter{}
}

func (e *procExecuter) Execute(ctx context.Context, config execution.Config) (proc *process.Process, exitCode int, err error) {
	// Prepare new command
	cmd, err := process.Prepare(&process.Template{
		Command:   config.Command,
		Args:      config.Args,
		OpenStdIn: false,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("unable to prepare command: %w", err)
	}

	// Add stdin from request, may be nil
	cmd.Proc.Stdin = config.Stdin

	// Add environment variables
	for key, value := range config.Env {
		cmd.Proc.Env = append(cmd.Proc.Env, fmt.Sprintf("%s=%s", key, value))
	}

	// Start and wait for command to finish
	if err := cmd.Proc.Run(); err != nil {
		if exitErr, isExitErr := err.(*exec.ExitError); isExitErr {
			return cmd, exitErr.ExitCode(), nil
		}

		return nil, -1, fmt.Errorf("error during command execution: %w", err)
	}

	// Return output
	return cmd, 0, nil
}

func (e *procExecuter) Describe() (mode execution.ExecMode, attributes []any) {
	return execution.ModeProc, []any{}
}
