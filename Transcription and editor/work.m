clc;
clear;
close all;

fprintf('Testing MATLAB intlinprog...\n\n');

%% MILP:
% Maximize:
%     10*x1 + 6*x2 + 8*x3
%
% Subject to:
%     5*x1 + 4*x2 + 3*x3 <= 10
%     3*x1 + 2*x2 + 4*x3 <= 8
%
% x1, x2, x3 are binary

f = [-10; -6; -8];   % Negative because intlinprog minimizes

A = [5 4 3;
    3 2 4];

b = [10;
    8];

intcon = [1 2 3];    % All variables are integer

lb = [0; 0; 0];
ub = [1; 1; 1];

%% Solver options
options = optimoptions('intlinprog', ...
    'Display', 'iter');

%% Solve
[x, fval, exitflag, output] = intlinprog( ...
    f, intcon, A, b, [], [], lb, ub, options);

%% Results
fprintf('\n================ RESULTS ================\n');

fprintf('Exit flag: %d\n', exitflag);

fprintf('x1 = %.0f\n', x(1));
fprintf('x2 = %.0f\n', x(2));
fprintf('x3 = %.0f\n', x(3));

fprintf('Maximum objective value = %.2f\n', -fval);

fprintf('==========================================\n');