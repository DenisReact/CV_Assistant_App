import { IsEmail, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  @MaxLength(254)
  email!: string;
}
