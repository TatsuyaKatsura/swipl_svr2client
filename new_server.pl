:- use_module(library(http/http_server)).
:- use_module(library(http/http_client)).
:- use_module(library(http/http_json)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_cors)).
:- use_module(library(pcre)).

% CORS対応
:- set_setting(http:cors, [*]).

% ルート定義
:- http_handler(root(query), handle_query, [post]).

% regex_match/3 の定義
regex_match(String, Pattern) :-
    re_match(Pattern, String).



% エンドポイントのハンドラ
handle_query(Request) :-
    cors_enable,
    http_read_json_dict(Request, Dict),
    Dict.get('predicate', Predicate),
    Dict.get('arg1', Arg1),
    Dict.get('arg2', Arg2Pattern),
    (   call(Predicate, Arg1, Arg2),
        regex_match(Arg2, Arg2Pattern)
    ->  Reply = json([result=true, data=Arg2])
    ;   Reply = json([result=false, data=null])
    ),
    reply_json(Reply).

% サーバの起動
start_server(Port) :-
    http_server([port(Port)]).

% サーバを開始するためのクエリ
% ?- start_server(8080).
