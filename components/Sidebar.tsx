import React from 'react';
import { Page } from '../types';
import Icon from './common/Icon';
import { icons } from 'lucide-react';

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
  pages: Page[];
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
}

const pageIcons: { [key in Page]: keyof typeof icons } = {
    'Dashboard': 'LayoutDashboard',
    'Inventário de Equipamentos': 'Computer',
    'Controle de Licenças': 'ScrollText',
    'Usuários e Permissões': 'Users',
    'Configurações': 'Settings',
    'Auditoria': 'History',
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage, pages, isSidebarOpen, setIsSidebarOpen }) => {

  return (
    <>
      <aside className={`fixed lg:relative inset-y-0 left-0 w-64 bg-brand-dark text-brand-light flex flex-col flex-shrink-0 z-30 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 ease-in-out`}>
        <div className="h-20 flex items-center justify-center bg-brand-secondary flex-shrink-0 px-4">
          <Icon name="ShieldCheck" size={24} className="text-brand-primary" />
          <h1 className="text-xl font-bold ml-2 truncate">Inventário Pro</h1>
        </div>
        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <ul>
            {pages.map((page) => (
              <li key={page} className="mb-2">
                <a
                  href="#"
                  data-testid={`nav-link-${page.replace(/\s+/g, '-')}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActivePage(page);
                    setIsSidebarOpen(false); // Close sidebar on mobile after navigation
                  }}
                  className={`flex items-center p-3 rounded-lg transition-colors ${
                    activePage === page
                      ? 'bg-brand-primary text-white'
                      : 'text-gray-300 hover:bg-brand-secondary hover:text-white'
                  }`}
                >
                  <Icon name={pageIcons[page]} size={20} className="mr-3" />
                  <span>{page}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="p-4 border-t border-gray-700 flex-shrink-0">
          <p className="text-xs text-gray-300 font-semibold">MRR INFORMATICA</p>
          <p className="text-xs text-gray-500 mt-1">&copy; 2022 Dev: Marcelo Reis</p>
        </div>
      </aside>
      {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black opacity-50 z-20 lg:hidden"></div>}
    </>
  );
};

export default Sidebar;