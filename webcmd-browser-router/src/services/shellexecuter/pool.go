package shellexecuter

import (
	"context"

	"github.com/bdoerfchen/webcmd/src/common/process"
)

type shellPool struct {
	pool     chan *process.Process
	template *process.Template
}

func NewPool(size uint, template process.Template) *shellPool {
	// Create pool
	pool := &shellPool{
		pool:     make(chan *process.Process, size),
		template: &template,
	}

	// Fill pool in background for defined size
	for range size {
		go pool.give()
	}

	return pool
}

// Number of processes that can be prepared
func (p *shellPool) Capacity() int {
	return cap(p.pool)
}

// Number of processes available to take
func (p *shellPool) Available() int {
	return len(p.pool)
}

// Take a process from the pool. Returns error if the context is closed before.
func (p *shellPool) Take(ctx context.Context) (*process.Process, error) {
	select {
	case proc := <-p.pool:
		// add another one back in the background
		go p.give()
		return proc, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Add a new process back into the pool
func (p *shellPool) give() {
	// Create process with connected input and output buffers
	proc, err := process.Prepare(p.template)
	if err != nil {
		panic("failed to start process: " + err.Error())
	}

	// Start process
	proc.Proc.Start()

	// Insert into queue
	p.pool <- proc
}
