function dialogFrame(title, message) {
  const dialog = document.createElement('dialog');
  dialog.className = 'patch-editor';
  const heading = document.createElement('h2');
  heading.id = `dialog-${crypto.randomUUID()}`;
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  const description = document.createElement('p');
  description.textContent = message;
  const actions = document.createElement('div');
  actions.className = 'patch-editor-actions';
  dialog.append(heading, description, actions);
  document.body.append(dialog);
  return { dialog, description, actions };
}

function button(actions, label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  actions.append(element);
  return element;
}

export function choose(title, message, choices) {
  return new Promise((resolve) => {
    const { dialog, actions } = dialogFrame(title, message);
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const [label, value, disabled] of choices) button(actions, label, () => finish(value)).disabled = Boolean(disabled);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
  });
}

export async function confirmAction(title, message, label = 'Confirm') {
  return await choose(title, message, [['Cancel', false], [label, true]]) === true;
}

export function askName(title, message, initial, validate = () => '') {
  return new Promise((resolve) => {
    const { dialog, actions } = dialogFrame(title, message);
    const label = document.createElement('label');
    label.textContent = 'Name';
    const input = document.createElement('input');
    input.value = initial;
    input.required = true;
    label.append(input);
    actions.before(label);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    actions.before(status);
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    button(actions, 'Cancel', () => finish(null));
    const submit = () => {
      const value = input.value.trim();
      const error = value ? validate(value) : 'Enter a name.';
      if (error) {
        status.textContent = error;
        input.focus();
        return;
      }
      finish(value);
    };
    button(actions, 'Save', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

export function exportDialog(name, formats) {
  return new Promise((resolve) => {
    const { dialog, actions } = dialogFrame('Export', 'Choose a file name and format.');
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'File name';
    const input = document.createElement('input');
    input.value = name;
    nameLabel.append(input);
    const formatLabel = document.createElement('label');
    formatLabel.textContent = 'Format';
    const select = document.createElement('select');
    for (const format of formats) select.add(new Option(format.label, format.id));
    formatLabel.append(select);
    const warning = document.createElement('p');
    warning.setAttribute('role', 'status');
    const updateWarning = () => { warning.textContent = formats.find((item) => item.id === select.value)?.warning || ''; };
    select.addEventListener('change', updateWarning);
    updateWarning();
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    actions.before(nameLabel, formatLabel, warning, error);
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    button(actions, 'Cancel', () => finish(null));
    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        error.textContent = 'Enter a file name.';
        input.focus();
        return;
      }
      const format = formats.find((item) => item.id === select.value);
      const filename = (format.extensions ?? [format.extension]).some((extension) => value.toLowerCase().endsWith(extension))
        ? value : `${value}${format.extension}`;
      finish({ filename, format: format.id });
    };
    button(actions, 'Export', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.showModal();
    input.focus();
    input.select();
  });
}
