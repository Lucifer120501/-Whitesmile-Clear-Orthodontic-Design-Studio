<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RegisterDoctorRequest;
use App\Models\Doctor;
use App\Models\Patient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class PatientController extends Controller
{
    public function create(): View
    {
        $doctors = Doctor::all();
        return view('admin.patient.create', compact('doctors'));
    }

    public function store(RegisterDoctorRequest $request): RedirectResponse
    {
        $doctor = Doctor::findOrFail($request->input('doctor_id'));
        
        $patient = Patient::create([
            'first_name' => $request->input('first_name'),
            'last_name' => $request->input('last_name'),
            'date_of_birth' => $request->input('date_of_birth'),
            'gender' => $request->input('gender'),
            'phone' => $request->input('phone'),
            'email' => $request->input('email'),
            'address' => $request->input('address'),
            'doctor_id' => $doctor->id,
            'clinic_id' => $request->input('clinic_id'),
            'mrn' => $request->input('mrn'),
            'status' => $request->input('status'),
        ]);

        return redirect()->route('admin.patient.index')
            ->with('success', 'Patient created successfully');
    }

    public function index(): View
    {
        $patients = Patient::with('doctor', 'clinic')->paginate(15);
        return view('admin.patient.index', compact('patients'));
    }
}