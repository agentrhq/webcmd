package paramcollection

import (
	"testing"

	"github.com/bdoerfchen/webcmd/src/common/config"
	"github.com/stretchr/testify/assert"
)

func TestParseParameters(t *testing.T) {
	testCases := []struct {
		Name               string
		Route              string
		ExpectedParamNames []string
	}{
		{Name: "none", Route: "/test", ExpectedParamNames: []string{}},
		{Name: "simple", Route: "/hello/{Id}", ExpectedParamNames: []string{"Id"}},
		{Name: "with config", Route: "/bonjour/{id:number}/something", ExpectedParamNames: []string{"id"}},
		{Name: "regex", Route: "/bonjour/{äöaSp:[A-Za-z]}/something", ExpectedParamNames: []string{"äöaSp"}},
		{Name: "broken", Route: "/bonjour/{äöaSp:as/something", ExpectedParamNames: []string{}},
		{Name: "multiple", Route: "/multiple/{one}/something/{two}", ExpectedParamNames: []string{"one", "two"}},
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			foundParamNames := paramNamesInRoute(tc.Route)
			assert.ElementsMatch(t, foundParamNames, tc.ExpectedParamNames)
		})
	}
}

func TestEnvNames(t *testing.T) {
	testCases := []struct {
		Name          string
		Route         string
		Parameters    []config.RouteParameter
		ExpectedNames []string
	}{
		{
			Name:          "default prefix and uppercase",
			Route:         "/",
			Parameters:    []config.RouteParameter{{Name: "test"}},
			ExpectedNames: []string{config.RouteParamPrefix + "TEST"},
		},
		{
			Name:          "doesnt begin with number",
			Route:         "/",
			Parameters:    []config.RouteParameter{{As: "28TEST"}},
			ExpectedNames: []string{"WC_28TEST"},
		},
		{
			Name:          "remove dash",
			Route:         "/",
			Parameters:    []config.RouteParameter{{As: "ABC-DEF"}},
			ExpectedNames: []string{"ABC_DEF"},
		},
		{
			Name:          "remove whitespace",
			Route:         "/",
			Parameters:    []config.RouteParameter{{As: "HELLO WORLD"}},
			ExpectedNames: []string{"HELLO_WORLD"},
		},
		{
			Name:          "remove non-ascii",
			Route:         "/",
			Parameters:    []config.RouteParameter{{As: "ÄÜÖ!=;#é?"}},
			ExpectedNames: []string{"_________"},
		},
		{
			Name:          "find route param implicitly",
			Route:         "/{test}",
			Parameters:    []config.RouteParameter{},
			ExpectedNames: []string{"WC_TEST"},
		},
		{
			Name:          "find route once",
			Route:         "/{test}",
			Parameters:    []config.RouteParameter{{Name: "test", Source: "route", As: "ABC_TEST"}},
			ExpectedNames: []string{"ABC_TEST"}, // only one entry
		},
		{
			Name:          "multiple",
			Route:         "/",
			Parameters:    []config.RouteParameter{{As: "TEST"}, {As: "TEST2"}},
			ExpectedNames: []string{"TEST", "TEST2"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			envNames := New(config.Route{
				Route:      tc.Route,
				Parameters: tc.Parameters,
			}).EnvNames()

			assert.ElementsMatch(t, tc.ExpectedNames, envNames)
		})
	}
}
