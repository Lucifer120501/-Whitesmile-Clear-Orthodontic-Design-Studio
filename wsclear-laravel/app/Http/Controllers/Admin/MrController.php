<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RegisterMrRequest;
use App\Models\Mr;
use App\Support\LegacyMd5Hasher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class MrController extends Controller
{
    public function create(): View
    {
        return view('admin.mr.create');
    }

    public function store(RegisterMrRequest $request): RedirectResponse
    {
        $mr = Mr::create([
            'name' => $request->input('name'),
            'email' => $request->input('email'),
            'password' => LegacyMd5Hasher::hash($request->input('password')),
            'clinic_id' => $request->input('clinic_id'),
            'phone' => $request->input('phone'),
        ]);

        return redirect()->route('admin.mr.index')
            ->with('success', 'MR created successfully');
    }

    public function index(): View
    {
        $mrs = Mr::with('clinic')->paginate(15);
        return view('admin.mr.index', compact('mrs'));
    }
}
