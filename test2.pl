brother('Tom','John').
father('Bob','Bobby').
old_man(X,Y):-brother(X,'John'),father(Y,Z),re_match("Bobb.*", Z).
