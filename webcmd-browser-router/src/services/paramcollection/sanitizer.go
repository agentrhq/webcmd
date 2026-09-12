package paramcollection

import (
	"regexp"
)

var forbiddenRegex = regexp.MustCompile("[#;%$\"`'&|]")

func sanitize(value string) string {
	return forbiddenRegex.ReplaceAllString(value, "")
}
