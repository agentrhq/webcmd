package paramcollection

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizer(t *testing.T) {
	testCases := []struct {
		Name          string
		InputValue    string
		ExpectedValue string
	}{
		{Name: "no subcommands", InputValue: "$(id)", ExpectedValue: "(id)"},
		{Name: "no dynamic variables", InputValue: "$PATH", ExpectedValue: "PATH"},
		{Name: "multiple variables", InputValue: "$PATH $OTHER", ExpectedValue: "PATH OTHER"},
		{Name: "no curly dynamic variables", InputValue: "${PATH}", ExpectedValue: "{PATH}"},
		{Name: "no comment", InputValue: "# dont execute what comes next", ExpectedValue: " dont execute what comes next"},
		{Name: "no command concat", InputValue: "; sudo cat /etc/shadow", ExpectedValue: " sudo cat /etc/shadow"},
		{Name: "no & concat", InputValue: "& sudo cat /etc/shadow", ExpectedValue: " sudo cat /etc/shadow"},
		{Name: "no | concat", InputValue: "| sudo cat /etc/shadow", ExpectedValue: " sudo cat /etc/shadow"},
		{Name: "no quotes", InputValue: "something\"; rm -rf /; export PATH=\"", ExpectedValue: "something rm -rf / export PATH="},
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			sanitized := sanitize(tc.InputValue)

			assert.Equal(t, tc.ExpectedValue, sanitized)
		})
	}
}
