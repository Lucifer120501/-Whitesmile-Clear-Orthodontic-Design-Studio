<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class RegisterMrRequest extends FormRequest
{
    public function authorize(): bool
    {
        return auth()->check() && auth()->user()->role === 'admin';
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:ws_mrs,email'],
            'password' => [
                'required',
                'string',
                'min:8',
                'regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/'
            ],
            'clinic_id' => ['required', 'integer', 'exists:ws_clinics,id'],
            'phone' => ['nullable', 'string', 'max:20'],
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
