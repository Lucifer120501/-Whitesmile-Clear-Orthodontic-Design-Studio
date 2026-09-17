<?php

use Illuminate\Support\Facades\Route;

// Home route - redirect to appropriate dashboard based on auth
Route::get('/', function () {
    return 'Home route works!';
})->name('home');

require __DIR__.'/auth.php';
