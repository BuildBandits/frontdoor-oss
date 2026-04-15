import { Link, useLocation } from 'react-router-dom';
import { LogOut, Settings, Home, Users, UserCog, Activity, Palette } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import BrandMark from './BrandMark';
import UserAvatar from './UserAvatar';

export default function Layout({ children }) {
  const { user, logout } = useAuthStore();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3">
              <BrandMark />
              <span className="font-bold text-lg text-dark">Frontdoor</span>
            </Link>

            {/* Nav links */}
            <div className="flex items-center gap-2">
              <Link
                to="/"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === '/'
                    ? 'bg-accent/20 text-dark'
                    : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                }`}
              >
                <Home className="w-4 h-4" />
                App
              </Link>

              {user?.role === 'admin' && (
                <>
                  <Link
                    to="/admin"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/admin'
                        ? 'bg-accent/20 text-dark'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    Gestione App
                  </Link>
                  <Link
                    to="/admin/groups"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/admin/groups'
                        ? 'bg-accent/20 text-dark'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    Gruppi
                  </Link>
                  <Link
                    to="/admin/users"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/admin/users'
                        ? 'bg-accent/20 text-dark'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    <UserCog className="w-4 h-4" />
                    Utenti
                  </Link>
                  <Link
                    to="/admin/logs"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/admin/logs'
                        ? 'bg-accent/20 text-dark'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    <Activity className="w-4 h-4" />
                    Log
                  </Link>
                  <Link
                    to="/admin/personalizza"
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/admin/personalizza'
                        ? 'bg-accent/20 text-dark'
                        : 'text-gray-500 hover:text-dark hover:bg-gray-50'
                    }`}
                  >
                    <Palette className="w-4 h-4" />
                    Personalizza
                  </Link>
                </>
              )}

              {/* User avatar + logout */}
              <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-100">
                <UserAvatar
                  userId={user?.id}
                  displayName={user?.displayName}
                  email={user?.email}
                  avatarColor={user?.avatarColor}
                  className="w-8 h-8"
                  initialsClassName="text-[10px]"
                />
                <span className="text-sm text-gray-600 hidden sm:block max-w-[120px] truncate">
                  {user?.displayName}
                </span>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
