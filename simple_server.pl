#!/usr/bin/env swipl
% -*- mode: Prolog -*-

% Start this with:
%   swipl simple_server.pl --port 9999 --staticdir static

% TODO: if using daemon:
%         swipl simple_server.pl --port=.... --pidfile=/var/run/simple_server.pid
%       and kill $(cat /var/run/simple_server.pid)

% TODO: Support HTTPS: https://www.swi-prolog.org/pldoc/man?section=ssl-https-server

% See README.md for an overview of how the code works.

% Access this from a browser with
%   http://localhost:9999
%     which does a redirect to:
%   http://localhost:9999/static/simple_client.html

% See also:
%    http://www.pathwayslms.com/swipltuts/html/index.html
%    https://swi-prolog.discourse.group/t/yet-another-web-applications-tutorial/566
%    https://www.swi-prolog.org/howto/http/

:- module(simple_server, [simple_server_main/0, simple_server_impl/0]).

:- use_module(library(http/http_server), [http_server/1, http_redirect/3,
                                          http_read_json_dict/3, reply_json_dict/2]).
:- use_module(library(http/http_path),   [http_absolute_location/3]).
:- use_module(library(http/http_files),  [http_reply_from_files/3]).

:- use_module(library(debug)).
:- use_module(library(optparse), [opt_arguments/3]).

% The most useful debug flags are here. A complete set of debug
% flags can be found by
%   find /usr/lib/swi-prolog/library/http/ -type f  | xargs -0 fgrep -nH 'debug('
:- debug(log).    % enable log messages with debug(log, '...', [...]).
:- debug(http(request)).
:- debug(http(error)).
% :- debug(redirect_log).
% :- debug(request_json_log).
% :- debug(http(post_request))
% :- debug(http_session).
% :- debug(http_path).
% :- debug(http(header)).
% :- debug(http(hook)).


% Start with simple_server_main.
:- initialization(simple_server_main, main).

:- multifile http:location/3.
:- multifile user:file_search_path/2.

:- dynamic http:location/3.

% assert_server_locations/3 dynamically set user:file_search_path/2
% using comnmand-line options. This is used by absolute_file_name/3
% to locate the directory for serving the files.
:- dynamic user:file_search_path/2.

% See https://www.swi-prolog.org/howto/http/HTTPFile.html
% and library(http/mimetype).
% e.g.: file_content_type('foo.js', text/javascript, 'text/javascript; charset=UTF-8').

%! http:location(+Alias, -Expansion, -Options) is nondet.
% See https://www.swi-prolog.org/pldoc/doc_for?object=http%3Alocation/3
% This is called by http_absolute_location(+Spec, -Path, +Options), e.g.:
% http_absolute_location(static('simple_client.js'), Path, []), Path='/static/simple_client.js'.
% http_absolute_location(json(.), Path, []), Path='/json/'.
http:location(static, root(static), []).
http:location(json, root(json), []).

%! simple_server_main/0 is det.
% Start the server, then start a top-level REPL.
% TODO: start the server as a daemon (see library(http/http_unix_daemon)),
%       which means not starting the REPL.
% See also library(main):main/0
simple_server_main :-
    simple_server_impl,
    debug(log, 'Starting REPL ...', []),
    prolog.  % REPL - terminated with exit.

%! simple_server_impl/0 is det.
% Process the options, start the http server.
simple_server_impl :-
    server_opts(Opts),
    % set_prolog_flag(verbose_file_search, true), % for debugging
    assert_server_locations(Opts),
    http_server([port(Opts.port),
                 % TODO: enable ssl (https):
                 % ssl([certificate_file('cacert.pem'), % or cert.csr?
                 %      key_file('privkey.pem')]),
                 workers(5)]).

%! server_opts(-Opts:dict) is det.
% Process the command-line options into a dict.
server_opts(Opts) :-
    MinPrologVersion = 80307,
    current_prolog_flag(version, PrologVersion),
    (   PrologVersion >= MinPrologVersion
    ->  true
    ;   throw(error(prolog_version >= MinPrologVersion,
                    context(current_prolog_flag(version,PrologVersion),
                            'SWI-Prolog version is too old')))
    ),
    OptsSpec =
        [[opt(port), type(integer), default(9999), longflags([port]),
          help('Server port')],
         [opt(staticdir), type(atom), default('static'), longflags([staticdir]),
          help('Directory for the static files (for "static" URL)')]],
    opt_arguments(OptsSpec, Opts0, PositionalArgs),
    dict_create(Opts, opts, Opts0),
    (   PositionalArgs == []
    ->  true
    ;   throw(error(extra_args,
                    context(PositionalArgs),
                    'Unknown positional arg(s)'))
    ).

%! assert_server_locations(+Opts:dict) is det.
% Assert user:file_search_path/2 facts for the static files that can
% then be accessed (using absolute_file_name/3) by
% static(FileName). This is asserted dynamically because the value is
% taken from the command line.
assert_server_locations(Opts) :-
    debug(log, 'static dir: ~q', [Opts.staticdir]),
    asserta(user:file_search_path(static_dir, Opts.staticdir)).

% http://localhost:9999/ ... redirects to /static/simple_client.html
%      - for debugging, 'moved' can be cleared by chrome://settings/clearBrowserData
%        (Cached images and files)
% You might want to also specify root('index.html').
:- http_handler(root(.),
                http_handler_redirect(
                    moved, % or 'moved_temporary', for easier debugging
                    static('simple_client.html')),
                []).

% Serve localhost:9999/static/ from 'static' directory (See also facts for http:location/3)
% For debugging, you might want cache(false).
% See also https://swi-prolog.discourse.group/t/how-to-debug-if-modified-since-with-http-reply-from-files/1892/3
:- http_handler(static(.),
                http_reply_from_files(static_dir(.), [cache(true)]),
                [prefix]).

:- http_handler(root(json),     % localhost:9999/json
                reply_with_json, [priority(0)]).

%! http_handler_redirect(+How:atom, +To, +Request) is det.
% Called by http_handler for a redirect.
%    How is moved_temporary or moved
%    To is a file path
%    Request is the incoming HTTP request
http_handler_redirect(How, To, Request) :-
    memberchk(path(Base), Request),
    memberchk(request_uri(RequestURI), Request),
    http_absolute_location(To, ToURL, [relative_to(Base)]),
    uri_components(RequestURI, URI),
    uri_data(path, URI, ToURL, ToURI),
    uri_components(NewTo, ToURI),
    debug(redirect_log, 'Redirect: ~q', [[how:How, to:To, toURL:ToURL, requestURI:RequestURI, uri:URI, toURI:ToURI, newTo: NewTo]]),
    http_redirect(How, NewTo, Request).

%! reply_with_json(+Request) is det.
% HTTP handler for "/json" request.
% This gets handed off to json_response/2.
reply_with_json(Request) :-
    (   memberchk(method(post), Request)
    ->  true
    ;   throw(error(invalid_request_type,
                    context(Request),
                    'Invalid request type'))
    ),
    http_read_json_dict(Request, JsonIn, % [content_type("application/json")]),
                        [value_string_as(atom), end_of_file(@(end)), default_tag(json),
                         true(#(true)),false(#(false)),null(#(null))]),
    debug(request_json_log, 'Request(json): ~q', [JsonIn]),
    (   json_response(JsonIn, JsonOut)
    ->  true
    ;   throw(error(failed_json_response,
                    context(JsonIn,
                            'json_response/2 failed')))
    ),
    reply_json_dict(JsonOut, [width(0)]). % TODO: consider Options=[status(201)]


%! json_response(+Request, -Result) is det.
% Process a request from the client. The Request is a "JSON" dict
% (as produced by json_read_dict/3) and the Results is a "JSON" dict
% that can be serialized with json_write_dict/2.
% For more details, see https://www.swi-prolog.org/pldoc/man?section=jsonsupport
%
% If you want to debug json_response/2 (to see what's sent to the client),
% you can use json_write_dict/2, which is in library(http/json:
% ?- json_response(json{query: "... GoalString ..."}, Result),
%    json_write(user_output, Result).
json_response(json{query: GoalString},
              json{success: TrueFalseError,
                   error: ErrorString,
                   query: GoalString,
                   query_after_call: GoalStringAfterCall,
                   printed_output: PrintedOutput,
                   vars: VarsResult}) :-
    catch(do_query(GoalString, TrueFalseError, GoalStringAfterCall, VarsResult, PrintedOutput, ErrorString),
          Error,
          handle_error(GoalString, TrueFalseError, GoalStringAfterCall, VarsResult, PrintedOutput, Error, ErrorString)
    ).

%! do_query(+GoalString:string, -TrueFalseError:atom, -GoalStringAfterCall:string,
%           -VarsResult:list, -PrintedOutput:string, -ErrorString:string) :-
% Parse the GoalString and call it, capturing the results, including success/error,
% variable bindings, output.
do_query(GoalString, TrueFalseError, GoalStringAfterCall, VarsResult, PrintedOutput, ErrorString) :-
    (   read_term_from_atom(GoalString, Goal, [syntax_errors(error), variable_names(Vars)]),
        with_output_to(string(PrintedOutput), Goal)
    ->  maplist(format_var, Vars, VarsResult),
        TrueFalseError = true,
        format(string(GoalStringAfterCall), '~q', [Goal])
    ;   VarsResult = [],
        TrueFalseError = false,
        PrintedOutput = "",
        GoalStringAfterCall = GoalString
    ),
    ErrorString = ''.

%! format_var(+VarEqualsValue, -JsonDict) is det.
% Format a Var=Value into a JSON structure.
format_var(Var=Value, json{var: Var, value: ValueStr}) :-
    format(string(ValueStr), '~q', [Value]).

%! handle_error(+GoalString:string, -TrueFalseError:atom, -GoalStringAfterCall:string,
%               -VarsResult:list, -PrintedOutput:string, +Error, -ErrorString:string) is det.
% Catch handler for json_response/2 - sets the output variables and also
% processes the error term.
handle_error(GoalString, TrueFalseError, GoalStringAfterCall, VarsResult, PrintedOutput, Error, ErrorString) :-
    TrueFalseError = error,
    GoalStringAfterCall = GoalString,
    VarsResult = [],
    PrintedOutput = "",
    format(string(ErrorString), '~q', [Error]).






