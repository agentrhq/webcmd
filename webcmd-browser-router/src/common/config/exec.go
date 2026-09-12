package config

type RouteExec struct {
	Proc  *ExecProc
	Shell *ExecShell
}

type ExecProc struct {
	Path string   // Process path
	Args []string // List of arguments for the command
}

type ExecShell struct {
	Command string // Shell command
}
