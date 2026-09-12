package execution

import (
	"fmt"
	"maps"
	"runtime"
	"slices"

	"github.com/bdoerfchen/webcmd/src/common/config"
)

type ExecMode string

const (
	ModeProc  ExecMode = "proc"
	ModeShell ExecMode = "shell"
)

// A collection of executers for different exec modes. Ready to use.
// Enables to pick the right executer for a route.
type ExecuterCollection struct {
	executers map[ExecMode]Executer
}

// Add an executer to the collection
func (c *ExecuterCollection) Add(executer Executer) {
	if c.executers == nil {
		c.executers = make(map[ExecMode]Executer)
	}

	mode, _ := executer.Describe()
	c.executers[mode] = executer
}

// Set an executer to the collection, but *not* for the provided os
func (c *ExecuterCollection) SetExcept(executer Executer, exceptOS ...string) {
	if !slices.Contains(exceptOS, runtime.GOOS) {
		c.Add(executer)
	}
}

// Set an executer to the collection, but *only* for the provided os
func (c *ExecuterCollection) SetOnly(executer Executer, onlyOS ...string) {
	if slices.Contains(onlyOS, runtime.GOOS) {
		c.Add(executer)
	}
}

// Retrieve list of all registered executers in this collection
func (c *ExecuterCollection) Available() []Executer {
	return slices.AppendSeq([]Executer{}, maps.Values(c.executers))
}

// Retrieve the right executer for a route
func (c *ExecuterCollection) For(route *config.Route) (Executer, error) {
	var mode ExecMode = ""
	switch {
	case route.Exec.Proc != nil:
		mode = ModeProc
	case route.Exec.Shell != nil:
		mode = ModeShell
	}

	executer, ok := c.executers[mode]
	if !ok {
		return nil, fmt.Errorf("no executer found for route. Disabled?")
	}

	return executer, nil
}
