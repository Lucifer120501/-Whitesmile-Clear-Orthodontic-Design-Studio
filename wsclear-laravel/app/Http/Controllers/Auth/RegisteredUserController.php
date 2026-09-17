<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterDoctorRequest;
use App\Models\Doctor;
use App\Support\LegacyMd5Hasher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class RegisteredUserController extends Controller
{
    public function create(): View
    {
        return view('auth.register');
    }

    public function store(RegisterDoctorRequest $request): RedirectResponse
    {
        $doctor = Doctor::create([
            'name' => $request->input('name'),
            'email' => $request->input('email'),
            'password' => LegacyMd5Hasher::hash($request->input('password')),
            'clinic_id' => $request->input('clinic_id'),
            'specialization' => $request->input('specialization'),
            'phone' => $request->input('phone'),
            'country_code' => $request->input('country_code'),
        ]);

        Auth::login($doctor);

        return redirect()->route('doctor.dashboard');
    }
}
