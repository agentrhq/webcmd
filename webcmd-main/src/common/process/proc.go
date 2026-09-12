package process

import (
	"bytes"
	"fmt"
	"io"
	"os/exec"
)

type Process struct {
	StdIn     io.WriteCloser
	StdOut    bytes.Buffer
	StdErr    bytes.Buffer
	StdOutErr bytes.Buffer
	Proc      *exec.Cmd
}

// Creates a new process reference with connected streams, but is not started yet
func Prepare(template *Template) (*Process, error) {
	result := &Process{}

	result.Proc = exec.Command(template.Command, template.Args...)
	if template.OpenStdIn {
		in, err := result.Proc.StdinPipe()
		if err != nil {
			return nil, fmt.Errorf("can not open stdinPipe: %w", err)
		}
		result.StdIn = in
	}

	// Connect stdout and stderr (+ multi buffer)
	result.Proc.Stdout = io.MultiWriter(&result.StdOut, &result.StdOutErr)
	result.Proc.Stderr = io.MultiWriter(&result.StdErr, &result.StdOutErr)

	return result, nil
}
