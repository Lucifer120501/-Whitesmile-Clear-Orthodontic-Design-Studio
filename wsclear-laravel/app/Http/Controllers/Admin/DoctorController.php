<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RegisterDoctorRequest;
use App\Models\Doctor;
use App\Support\LegacyMd5Hasher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class DoctorController extends Controller
{
    public function create(): View
    {
        return view('admin.doctor.create');
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

        return redirect()->route('admin.doctor.index')
            ->with('success', 'Doctor created successfully');
    }

    public function index(): View
    {
        $doctors = Doctor::with('clinic')->paginate(15);
        return view('admin.doctor.index', compact('doctors'));
    }
}
