// synergy-backend/models/User.js
export class User {
  constructor({ id, name, email, passwordHash, role, createdAt }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role || 'user';
    this.createdAt = createdAt || new Date();
  }
}
