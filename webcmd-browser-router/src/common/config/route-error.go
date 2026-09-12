package config

type RouteErrorLevel int

var (
	ErrorLevelInfo     RouteErrorLevel = 0
	ErrorLevelWarning  RouteErrorLevel = 1
	ErrorLevelCritical RouteErrorLevel = 2
)

type RouteError struct {
	Message string
	Level   RouteErrorLevel
}

type RouteErrorCollection []RouteError

// Returns true if there is a critical error in collection
func (c RouteErrorCollection) IsCritical() bool {
	for _, e := range c {
		if e.Level == ErrorLevelCritical {
			return true
		}
	}

	return false
}

// Returns highest level or nil if no error in collection
func (c RouteErrorCollection) HighestLevel() *RouteErrorLevel {
	if len(c) == 0 {
		return nil
	}

	highest := ErrorLevelInfo

	for _, e := range c {
		if e.Level > highest {
			highest = e.Level
		}
	}

	return &highest
}
