<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RegisterDoctorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:ws_doctors,email'],
            'password' => [
                'required',
                'string',
                'min:8',
                'confirmed',
                'regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/'
            ],
            'clinic_id' => ['nullable', 'integer', 'exists:ws_clinics,id'],
            'specialization' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:20'],
            'country_code' => ['nullable', 'string', 'max:10'],
        ];
    }

    public function messages(): array
    {
        return [
            'password.regex' => 'The password must contain at least one uppercase letter, one lowercase letter, and one number.',
            'password.min' => 'The password must be at least 8 characters.',
        ];
    }
}
